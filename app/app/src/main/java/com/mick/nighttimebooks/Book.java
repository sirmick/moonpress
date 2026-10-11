package com.mick.nighttimebooks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/** A book folder: book.json + cover.webp + pNN.webp, as packaged by moonpress and synced from Nightstand. */
public class Book {
    public static class Page {
        public final File image; public final String text; public final boolean textTop; public final String word;
        Page(File image, String text, boolean textTop, String word) { this.image = image; this.text = text; this.textTop = textTop; this.word = word; }
    }

    public final File dir; public final String title; public final File cover; public final boolean reading;
    public final List<Page> pages = new ArrayList<>();

    private Book(File dir, String title, File cover, boolean reading) { this.dir = dir; this.title = title; this.cover = cover; this.reading = reading; }

    /** Returns null if the folder is not a valid book. */
    public static Book load(File dir) {
        try {
            File manifest = new File(dir, "book.json");
            if (!manifest.isFile()) return null;
            JSONObject o = new JSONObject(new String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8));
            Book b = new Book(dir, o.getString("title"), new File(dir, o.optString("cover", "cover.png")),
                    "reading".equals(o.optString("set", "bedtime")));
            JSONArray arr = o.getJSONArray("pages");
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.getJSONObject(i);
                b.pages.add(new Page(new File(dir, p.getString("image")), p.getString("text"),
                        "top".equals(p.optString("text_pos", "bottom")), p.optString("word", "")));
            }
            return b.pages.isEmpty() ? null : b;
        } catch (Exception e) {
            return null;
        }
    }

    public static List<Book> loadAll(File root) {
        List<Book> books = new ArrayList<>();
        File[] dirs = root.listFiles(File::isDirectory);
        if (dirs == null) return books;
        java.util.Arrays.sort(dirs);
        for (File d : dirs) { Book b = load(d); if (b != null) books.add(b); }
        return books;
    }
}
