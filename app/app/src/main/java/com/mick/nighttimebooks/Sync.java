package com.mick.nighttimebooks;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Pulls the shelf from Nightstand. Offline first: the library only ever reads local files; sync downloads
 * whole books into a temp folder and renames them into place, so a dropped connection never leaves a half book.
 *
 * Layout on the device: files/books/<slug>/{book.json, cover.webp, p01.webp...} plus a .hash file holding the
 * catalog hash the folder was downloaded at. Books bundled in the APK (assets/books/) are installed on first run.
 */
public class Sync {
    public interface Listener { void onDone(int updated, String message, boolean error); }

    static final String DEFAULT_BASE = "https://sirmick.github.io/nightstand/";
    static final int CONNECT_MS = 4000, READ_MS = 15000;

    public static File booksDir(Context c) {
        File d = new File(c.getFilesDir(), "books");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    /** files/base_url.txt overrides the shelf's address, for a LAN editor server. */
    static String baseUrl(Context c) {
        File f = new File(c.getFilesDir(), "base_url.txt");
        if (f.isFile()) {
            try {
                String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
                if (!s.isEmpty()) return s.endsWith("/") ? s : s + "/";
            } catch (Exception ignored) {}
        }
        return DEFAULT_BASE;
    }

    static long appVersion(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode(); }
        catch (Exception e) { return 1; }
    }

    static String localHash(File bookDir) {
        File f = new File(bookDir, ".hash");
        try { return f.isFile() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim() : ""; }
        catch (Exception e) { return ""; }
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    /** Books bundled in the APK: install any that are missing locally. Returns how many were installed. */
    public static int installBundled(Context c) {
        int installed = 0;
        try {
            AssetManager am = c.getAssets();
            String[] slugs = am.list("books");
            if (slugs == null) return 0;
            JSONObject catalog = null;
            try (InputStream in = am.open("books/catalog.json")) { catalog = new JSONObject(readAll(in)); } catch (Exception ignored) {}
            for (String slug : slugs) {
                String[] files = am.list("books/" + slug);
                if (files == null || files.length == 0) continue;
                File dst = new File(booksDir(c), slug);
                if (new File(dst, "book.json").isFile()) continue;
                File tmp = new File(booksDir(c), ".tmp-" + slug);
                deleteTree(tmp); tmp.mkdirs();
                for (String f : files) {
                    try (InputStream in = am.open("books/" + slug + "/" + f); OutputStream out = new FileOutputStream(new File(tmp, f))) { copy(in, out); }
                }
                writeHash(tmp, hashFor(catalog, slug));
                deleteTree(dst);
                if (tmp.renameTo(dst)) installed++;
            }
        } catch (Exception ignored) {}
        return installed;
    }

    /** Fetch the catalog and download every book whose hash differs from the local copy. */
    public static void run(Context c, boolean manual, Listener l) {
        Handler ui = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            int updated = 0; String message; boolean error = false;
            try {
                String base = baseUrl(c);
                JSONObject catalog = new JSONObject(fetch(base + "catalog.json"));
                long minApp = catalog.optLong("minApp", 1);
                if (minApp > appVersion(c)) {
                    message = "A newer Nighttime Books app is needed for new books.";
                    error = true;
                } else {
                    JSONArray books = catalog.getJSONArray("books");
                    for (int i = 0; i < books.length(); i++) {
                        JSONObject b = books.getJSONObject(i);
                        String slug = b.getString("slug"), hash = b.optString("hash", "");
                        File dst = new File(booksDir(c), slug);
                        if (hash.equals(localHash(dst)) && new File(dst, "book.json").isFile()) continue;
                        File tmp = new File(booksDir(c), ".tmp-" + slug);
                        deleteTree(tmp); tmp.mkdirs();
                        JSONArray files = b.getJSONArray("files");
                        for (int j = 0; j < files.length(); j++) {
                            String f = files.getString(j);
                            download(base + "books/" + slug + "/out/" + f, new File(tmp, f));
                        }
                        writeHash(tmp, hash);
                        deleteTree(dst);
                        if (!tmp.renameTo(dst)) throw new Exception("could not install " + slug);
                        updated++;
                    }
                    message = updated == 0 ? "Up to date" : updated + (updated == 1 ? " book updated" : " books updated");
                }
            } catch (Exception e) {
                message = manual ? "Sync failed: " + e.getMessage() : null;
                error = true;
            }
            final int u = updated; final String m = message; final boolean err = error;
            ui.post(() -> l.onDone(u, m, err));
        }, "nightstand-sync").start();
    }

    private static String hashFor(JSONObject catalog, String slug) {
        try {
            JSONArray books = catalog.getJSONArray("books");
            for (int i = 0; i < books.length(); i++) if (slug.equals(books.getJSONObject(i).getString("slug"))) return books.getJSONObject(i).optString("hash", "");
        } catch (Exception ignored) {}
        return "";
    }

    private static void writeHash(File dir, String hash) throws Exception {
        try (OutputStream out = new FileOutputStream(new File(dir, ".hash"))) { out.write(hash.getBytes(StandardCharsets.UTF_8)); }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(CONNECT_MS); h.setReadTimeout(READ_MS);
        h.setRequestProperty("User-Agent", "NighttimeBooks/" + 2);
        if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode() + " for " + url);
        return h;
    }

    private static String fetch(String url) throws Exception {
        HttpURLConnection h = open(url);
        try (InputStream in = h.getInputStream()) { return readAll(in); } finally { h.disconnect(); }
    }

    private static void download(String url, File dst) throws Exception {
        HttpURLConnection h = open(url);
        try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(dst)) { copy(in, out); } finally { h.disconnect(); }
    }

    private static String readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        copy(in, bo);
        return bo.toString("UTF-8");
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}
