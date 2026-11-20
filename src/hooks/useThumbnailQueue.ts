import React from "react";
import { mergeThumbCacheLru, THUMB_CACHE_MAX_ENTRIES } from "../lib/imageGrid";

export interface ThumbRenderOutput<TMeta = undefined> {
  url: string;
  meta?: TMeta;
}

export interface UseThumbnailQueueOptions<TMeta = undefined> {
  enabled?: boolean;
  concurrency?: number;
  maxCacheEntries?: number;
  flushIntervalMs?: number;
  /** Render/fetch thumbnail for `key`. Returning `null` skips caching without marking failed. */
  renderKey: (key: string) => Promise<ThumbRenderOutput<TMeta> | null>;
  /** Optional version signature per key (e.g. edits/rotation); null means key was deleted. */
  getKeySignature?: (key: string) => string | null;
}

export interface UseThumbnailQueueResult<TMeta = undefined> {
  thumbs: Record<string, string>;
  thumbsRef: React.MutableRefObject<Record<string, string>>;
  thumbMetas: Record<string, TMeta>;
  thumbMetasRef: React.MutableRefObject<Record<string, TMeta>>;
  thumbSigsRef: React.MutableRefObject<Record<string, string>>;
  visibleKeysRef: React.MutableRefObject<Set<string>>;
  pinnedKeysRef: React.MutableRefObject<Set<string>>;
  failedKeysRef: React.MutableRefObject<Set<string>>;
  enqueueKey: (key: string, allowDuplicatePush?: boolean) => void;
  enqueueWindow: (keys: string[], replaceVisible?: boolean) => void;
  setPinnedKeys: (keys: ReadonlySet<string>, enqueueMissing?: boolean) => void;
  clearFailedKey: (key: string) => void;
  remapCache: (mapKey: (oldKey: string) => string | null) => void;
  resetAll: () => void;
}

/**
 * Shared LIFO concurrent thumbnail worker queue with 40ms batched state flush,
 * generation-token cancellation, and viewport-protected LRU eviction.
 */
export function useThumbnailQueue<TMeta = undefined>({
  enabled = true,
  concurrency = 3,
  maxCacheEntries = THUMB_CACHE_MAX_ENTRIES,
  flushIntervalMs = 40,
  renderKey,
  getKeySignature,
}: UseThumbnailQueueOptions<TMeta>): UseThumbnailQueueResult<TMeta> {
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  const thumbsRef = React.useRef<Record<string, string>>(thumbs);
  thumbsRef.current = thumbs;

  const [thumbMetas, setThumbMetas] = React.useState<Record<string, TMeta>>({});
  const thumbMetasRef = React.useRef<Record<string, TMeta>>(thumbMetas);
  thumbMetasRef.current = thumbMetas;

  const thumbSigsRef = React.useRef<Record<string, string>>({});
  const visibleKeysRef = React.useRef<Set<string>>(new Set());
  const pinnedKeysRef = React.useRef<Set<string>>(new Set());
  const queuedSetRef = React.useRef<Set<string>>(new Set());
  const queuedOrderRef = React.useRef<string[]>([]);
  const inFlightKeysRef = React.useRef<Set<string>>(new Set());
  const failedKeysRef = React.useRef<Set<string>>(new Set());
  const activeWorkersRef = React.useRef<number>(0);
  const genRef = React.useRef<number>(0);

  const pendingUrlBatchRef = React.useRef<Record<string, string>>({});
  const pendingMetaBatchRef = React.useRef<Record<string, TMeta>>({});
  const pendingSigBatchRef = React.useRef<Record<string, string>>({});
  const flushTimerRef = React.useRef<number | null>(null);

  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  const renderKeyRef = React.useRef(renderKey);
  renderKeyRef.current = renderKey;
  const getKeySigRef = React.useRef(getKeySignature);
  getKeySigRef.current = getKeySignature;

  const flushPending = React.useCallback(() => {
    flushTimerRef.current = null;
    const urlBatch = pendingUrlBatchRef.current;
    if (Object.keys(urlBatch).length === 0) return;

    const metaBatch = pendingMetaBatchRef.current;
    const sigBatch = pendingSigBatchRef.current;
    pendingUrlBatchRef.current = {};
    pendingMetaBatchRef.current = {};
    pendingSigBatchRef.current = {};

    const protectedKeys = new Set<string>(visibleKeysRef.current);
    pinnedKeysRef.current.forEach((k) => protectedKeys.add(k));

    const { nextCache, evictedIds } = mergeThumbCacheLru(
      thumbsRef.current,
      urlBatch,
      maxCacheEntries,
      protectedKeys,
    );

    const nextMetas: Record<string, TMeta> = { ...thumbMetasRef.current };
    for (const [k, m] of Object.entries(metaBatch)) {
      nextMetas[k] = m;
    }
    const nextSigs: Record<string, string> = { ...thumbSigsRef.current };
    for (const [k, s] of Object.entries(sigBatch)) {
      nextSigs[k] = s;
    }
    for (const evicted of evictedIds) {
      delete nextMetas[evicted];
      delete nextSigs[evicted];
    }

    thumbsRef.current = nextCache;
    thumbMetasRef.current = nextMetas;
    thumbSigsRef.current = nextSigs;
    setThumbs(nextCache);
    setThumbMetas(nextMetas);
  }, [maxCacheEntries]);

  const scheduleFlush = React.useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flushPending, flushIntervalMs);
  }, [flushPending, flushIntervalMs]);

  const popNextPrioritizedKey = React.useCallback((): string | undefined => {
    const order = queuedOrderRef.current;
    // Ưu tiên tuyệt đối các trang đang hiển thị trên màn hình trước các trang pinned ở ngoài màn hình.
    for (let i = order.length - 1; i >= 0; i--) {
      const candidate = order[i];
      if (visibleKeysRef.current.has(candidate)) {
        order.splice(i, 1);
        return candidate;
      }
    }
    return order.pop();
  }, []);

  const pumpQueue = React.useCallback(() => {
    if (!enabledRef.current) return;
    const cap = Math.max(1, concurrency);

    while (activeWorkersRef.current < cap && queuedOrderRef.current.length > 0) {
      const key = popNextPrioritizedKey();
      if (!key) break;
      if (!queuedSetRef.current.delete(key)) continue;
      if (!visibleKeysRef.current.has(key) && !pinnedKeysRef.current.has(key)) continue;

      const sigFn = getKeySigRef.current;
      const sig = sigFn ? sigFn(key) : "";
      if (sig === null) continue;

      if (
        (thumbsRef.current[key] && (!sigFn || thumbSigsRef.current[key] === sig)) ||
        inFlightKeysRef.current.has(key) ||
        failedKeysRef.current.has(key)
      ) {
        continue;
      }

      inFlightKeysRef.current.add(key);
      activeWorkersRef.current += 1;
      const gen = genRef.current;

      void (async () => {
        try {
          const result = await renderKeyRef.current(key);
          if (genRef.current !== gen || !enabledRef.current || !result) return;

          if (sigFn) {
            const latestSig = sigFn(key);
            if (latestSig !== sig) return;
          }

          thumbsRef.current[key] = result.url;
          pendingUrlBatchRef.current[key] = result.url;
          if (result.meta !== undefined) {
            thumbMetasRef.current[key] = result.meta;
            pendingMetaBatchRef.current[key] = result.meta;
          }
          if (sigFn) {
            thumbSigsRef.current[key] = sig;
            pendingSigBatchRef.current[key] = sig;
          }
          scheduleFlush();
        } catch {
          if (genRef.current === gen && enabledRef.current) {
            failedKeysRef.current.add(key);
          }
        } finally {
          inFlightKeysRef.current.delete(key);
          activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
          if (sigFn) {
            const latestSig = sigFn(key);
            if (
              latestSig !== null &&
              latestSig !== sig &&
              (visibleKeysRef.current.has(key) || pinnedKeysRef.current.has(key))
            ) {
              queuedSetRef.current.add(key);
              queuedOrderRef.current.push(key);
            }
          }
          if (genRef.current === gen && enabledRef.current) {
            pumpQueue();
          }
        }
      })();
    }
  }, [concurrency, popNextPrioritizedKey, scheduleFlush]);

  const isKeyFresh = React.useCallback((key: string): boolean => {
    const sigFn = getKeySigRef.current;
    const sig = sigFn ? sigFn(key) : "";
    if (sig === null) return true; // Deleted key shouldn't be queued
    return (
      Boolean(thumbsRef.current[key] && (!sigFn || thumbSigsRef.current[key] === sig)) ||
      inFlightKeysRef.current.has(key) ||
      failedKeysRef.current.has(key)
    );
  }, []);

  const enqueueKey = React.useCallback(
    (key: string, allowDuplicatePush = false) => {
      if (!enabledRef.current || isKeyFresh(key)) return;
      if (!queuedSetRef.current.has(key)) {
        queuedSetRef.current.add(key);
        queuedOrderRef.current.push(key);
      } else if (allowDuplicatePush) {
        queuedOrderRef.current.push(key);
      }
      pumpQueue();
    },
    [isKeyFresh, pumpQueue],
  );

  const enqueueWindow = React.useCallback(
    (keys: string[], replaceVisible = true) => {
      if (!enabledRef.current) return;
      if (replaceVisible) {
        visibleKeysRef.current = new Set(keys);
        // Cắt bỏ ngay các key đã cuộn ra khỏi màn hình (và không pinned) để queue không bị ứ hàng trăm request cũ.
        if (queuedOrderRef.current.length > 0) {
          const retained: string[] = [];
          const retainedSet = new Set<string>();
          for (const queuedKey of queuedOrderRef.current) {
            if (visibleKeysRef.current.has(queuedKey) || pinnedKeysRef.current.has(queuedKey)) {
              retained.push(queuedKey);
              retainedSet.add(queuedKey);
            }
          }
          queuedOrderRef.current = retained;
          queuedSetRef.current = retainedSet;
        }
      } else {
        keys.forEach((k) => visibleKeysRef.current.add(k));
      }
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        if (isKeyFresh(key)) continue;
        if (!queuedSetRef.current.has(key)) {
          queuedSetRef.current.add(key);
          queuedOrderRef.current.push(key);
        }
      }
      pumpQueue();
    },
    [isKeyFresh, pumpQueue],
  );

  const setPinnedKeys = React.useCallback(
    (keys: ReadonlySet<string>, enqueueMissing = false) => {
      pinnedKeysRef.current = new Set(keys);
      if (enqueueMissing && enabledRef.current && keys.size > 0) {
        keys.forEach((k) => enqueueKey(k));
      }
    },
    [enqueueKey],
  );

  const clearFailedKey = React.useCallback((key: string) => {
    failedKeysRef.current.delete(key);
  }, []);

  const remapCache = React.useCallback((mapKey: (oldKey: string) => string | null) => {
    genRef.current += 1;
    queuedSetRef.current.clear();
    queuedOrderRef.current = [];
    failedKeysRef.current.clear();
    pendingUrlBatchRef.current = {};
    pendingMetaBatchRef.current = {};
    pendingSigBatchRef.current = {};
    visibleKeysRef.current.clear();
    pinnedKeysRef.current.clear();

    const nextThumbs: Record<string, string> = {};
    const nextMetas: Record<string, TMeta> = {};
    const nextSigs: Record<string, string> = {};

    for (const [k, url] of Object.entries(thumbsRef.current)) {
      const remapped = mapKey(k);
      if (!remapped) continue;
      nextThumbs[remapped] = url;
      if (k in thumbMetasRef.current) {
        nextMetas[remapped] = thumbMetasRef.current[k];
      }
      if (k in thumbSigsRef.current) {
        nextSigs[remapped] = thumbSigsRef.current[k];
      }
    }

    thumbsRef.current = nextThumbs;
    thumbMetasRef.current = nextMetas;
    thumbSigsRef.current = nextSigs;
    setThumbs(nextThumbs);
    setThumbMetas(nextMetas);
  }, []);

  const resetAll = React.useCallback(() => {
    genRef.current += 1;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingUrlBatchRef.current = {};
    pendingMetaBatchRef.current = {};
    pendingSigBatchRef.current = {};
    queuedSetRef.current.clear();
    queuedOrderRef.current = [];
    failedKeysRef.current.clear();
    visibleKeysRef.current.clear();
    pinnedKeysRef.current.clear();
    thumbsRef.current = {};
    thumbMetasRef.current = {};
    thumbSigsRef.current = {};
    setThumbs({});
    setThumbMetas({});
  }, []);

  React.useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  return React.useMemo(
    () => ({
      thumbs,
      thumbsRef,
      thumbMetas,
      thumbMetasRef,
      thumbSigsRef,
      visibleKeysRef,
      pinnedKeysRef,
      failedKeysRef,
      enqueueKey,
      enqueueWindow,
      setPinnedKeys,
      clearFailedKey,
      remapCache,
      resetAll,
    }),
    [
      thumbs,
      thumbMetas,
      enqueueKey,
      enqueueWindow,
      setPinnedKeys,
      clearFailedKey,
      remapCache,
      resetAll,
    ],
  );
}
