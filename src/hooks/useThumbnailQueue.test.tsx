// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThumbnailQueue } from "./useThumbnailQueue";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useThumbnailQueue", () => {
  it("caps concurrency, drains LIFO order, batches flush, and ignores stale results after resetAll", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let inflight = 0;
    let peak = 0;
    const resolvers = new Map<string, (val: { url: string } | null) => void>();

    function Harness() {
      const q = useThumbnailQueue({
        concurrency: 2,
        flushIntervalMs: 40,
        renderKey: (key) => {
          order.push(key);
          inflight += 1;
          peak = Math.max(peak, inflight);
          return new Promise<{ url: string } | null>((res) => {
            resolvers.set(key, (v) => {
              inflight -= 1;
              res(v);
            });
          });
        },
      });
      return (
        <div>
          <button type="button" onClick={() => q.enqueueWindow(["k1", "k2", "k3", "k4"])}>
            enqueue
          </button>
          <button type="button" onClick={() => q.resetAll()}>
            reset
          </button>
          <span data-testid="keys">{Object.keys(q.thumbs).join(",")}</span>
        </div>
      );
    }

    render(<Harness />);
    act(() => {
      screen.getByText("enqueue").click();
    });

    // enqueueWindow pushes bottom-to-top, so LIFO pop() picks k1 and k2 first (concurrency=2)
    expect(order).toEqual(["k1", "k2"]);
    expect(peak).toBe(2);

    await act(async () => {
      resolvers.get("k1")?.({ url: "u1" });
      resolvers.get("k2")?.({ url: "u2" });
      await Promise.resolve();
    });

    // Flush batched at 40ms
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(screen.getByTestId("keys").textContent).toBe("k1,k2");

    // Trigger resetAll while k3/k4 are still in flight -> their resolution must be discarded
    act(() => {
      screen.getByText("reset").click();
    });
    expect(screen.getByTestId("keys").textContent).toBe("");

    await act(async () => {
      resolvers.get("k3")?.({ url: "u3" });
      resolvers.get("k4")?.({ url: "u4" });
      await Promise.resolve();
      vi.advanceTimersByTime(40);
    });
    expect(screen.getByTestId("keys").textContent).toBe("");
  });

  it("prunes stale off-screen keys when visible window scrolls and prioritizes visible over pinned keys", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, (val: { url: string } | null) => void>();

    function ScrollHarness() {
      const q = useThumbnailQueue({
        concurrency: 1,
        renderKey: (key) => {
          started.push(key);
          return new Promise<{ url: string } | null>((res) => resolvers.set(key, res));
        },
      });
      return (
        <div>
          <button
            type="button"
            onClick={() => q.setPinnedKeys(new Set(["pin1", "pin2"]), true)}
          >
            pin
          </button>
          <button type="button" onClick={() => q.enqueueWindow(["old1", "old2"])}>
            win1
          </button>
          <button type="button" onClick={() => q.enqueueWindow(["new1"])}>
            win2
          </button>
        </div>
      );
    }

    render(<ScrollHarness />);
    act(() => {
      screen.getByText("win1").click(); // starts old1, queues old2
      screen.getByText("pin").click(); // queues pin1, pin2
      screen.getByText("win2").click(); // replaces visible with new1 -> prunes old2, new1 takes priority over pinned
    });

    expect(started).toEqual(["old1"]);

    await act(async () => {
      resolvers.get("old1")?.({ url: "u-old1" });
      await Promise.resolve();
    });
    // Must pick visible "new1" BEFORE "pin1"/"pin2" and never render pruned "old2"
    expect(started).toEqual(["old1", "new1"]);
    expect(started).not.toContain("old2");
  });
});
