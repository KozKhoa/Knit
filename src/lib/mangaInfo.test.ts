import { describe, expect, it } from "vitest";
import {
  applyFormToJsonObject,
  createDefaultInfoTemplate,
  joinStoryPath,
  jsonObjectToForm,
  jsonObjectToStoryInfo,
  parseInfoJsonObject,
} from "./mangaInfo";

describe("mangaInfo helpers", () => {
  it("joins story paths across POSIX and Windows separators", () => {
    expect(joinStoryPath("/home/user/Manga/AoT", "info.json")).toBe("/home/user/Manga/AoT/info.json");
    expect(joinStoryPath("/home/user/Manga/AoT/", "/info.json")).toBe("/home/user/Manga/AoT/info.json");
    expect(joinStoryPath("C:\\Manga\\AoT", "info.json")).toBe("C:\\Manga\\AoT\\info.json");
  });

  it("round-trips form fields while preserving extra JSON keys", () => {
    const base = {
      title: "Attack on Titan",
      description: "Summary here",
      genres: ["Action", "Drama"],
      author: ["Isayama Hajime"],
      other_titles: ["Shingeki no Kyojin", "Đại Chiến Titan"],
      nation: "Japan",
      nation_id: "uuid-1",
      poster_id: "uuid-2",
      cover_art: "cover.jpg",
    };

    const form = jsonObjectToForm(base);
    expect(form.title).toBe("Attack on Titan");
    expect(form.genres).toBe("Action, Drama");
    expect(form.author).toBe("Isayama Hajime");
    expect(form.other_titles).toBe("Shingeki no Kyojin, Đại Chiến Titan");

    const updated = applyFormToJsonObject(base, {
      ...form,
      genres: "Action, Drama, Mystery",
      status: "completed",
    });

    expect(updated.cover_art).toBe("cover.jpg");
    expect(updated.genres).toEqual(["Action", "Drama", "Mystery"]);
    expect(updated.status).toBe("completed");

    const preview = jsonObjectToStoryInfo(updated);
    expect(preview.title).toBe("Attack on Titan");
    expect(preview.authors).toEqual(["Isayama Hajime"]);
    expect(preview.status).toBe("completed");
  });

  it("builds default template and rejects non-object JSON payloads", () => {
    const tpl = createDefaultInfoTemplate("One Piece");
    expect(tpl.title).toBe("One Piece");
    expect(tpl.type).toBe("manga");
    expect(parseInfoJsonObject("[1, 2, 3]").ok).toBe(false);
    expect(parseInfoJsonObject("\uFEFF{\"title\":\"One Piece\"}").ok).toBe(true);
  });
});
