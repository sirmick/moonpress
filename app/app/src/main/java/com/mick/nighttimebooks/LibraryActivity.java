package com.mick.nighttimebooks;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Grid of covers. Tap a cover to read. Tabs for the two sets, and a sync button that pulls the shelf from Nightstand. */
public class LibraryActivity extends Activity {
    private static final int COLUMNS = 4;
    private final List<Book> books = new ArrayList<>();
    private GridView grid; private TextView empty, notice; private BaseAdapter adapter;
    private TextView tabBedtime, tabReading, tabSync; private boolean showReading, syncing;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        int w = getResources().getDisplayMetrics().widthPixels;
        int pad = w / 40;

        grid = new GridView(this);
        grid.setNumColumns(COLUMNS);
        grid.setPadding(pad, pad, pad, pad);
        grid.setVerticalSpacing(pad); grid.setHorizontalSpacing(pad);
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setSelector(android.R.color.transparent);
        grid.setBackgroundColor(Color.WHITE);
        grid.setVerticalScrollBarEnabled(false);
        grid.setOverScrollMode(View.OVER_SCROLL_NEVER);
        adapter = new CoverAdapter((w - pad * (COLUMNS + 1)) / COLUMNS);
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((p, v, pos, id) -> open(books.get(pos)));

        empty = new TextView(this);
        empty.setGravity(Gravity.CENTER);
        empty.setTextColor(Color.BLACK);
        empty.setTextSize(20);
        empty.setPadding(pad * 2, pad * 2, pad * 2, pad * 2);
        empty.setText(getString(R.string.empty, Sync.booksDir(this).getAbsolutePath()));
        grid.setEmptyView(empty);

        showReading = getPreferences(MODE_PRIVATE).getBoolean("reading", false);
        LinearLayout tabs = new LinearLayout(this);
        tabBedtime = tab("Bedtime", false); tabReading = tab("Reading", true);
        tabSync = tab("↻", false);
        tabSync.setOnClickListener(v -> sync(true));
        tabs.addView(tabBedtime, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        tabs.addView(tabReading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        tabs.addView(tabSync, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        notice = new TextView(this);
        notice.setGravity(Gravity.CENTER);
        notice.setTextColor(Color.BLACK);
        notice.setTextSize(15);
        notice.setTypeface(Typeface.SERIF);
        notice.setPadding(pad, pad / 2, pad, pad / 2);
        notice.setVisibility(View.GONE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.addView(tabs, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(notice, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(grid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(empty, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) c.hide(WindowInsets.Type.systemBars());

        if (Sync.installBundled(this) > 0) reload();
        if (saved == null) sync(false);
    }

    private TextView tab(String label, boolean reading) {
        TextView t = new TextView(this);
        t.setText(label); t.setGravity(Gravity.CENTER); t.setTextSize(22);
        t.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        int p = getResources().getDisplayMetrics().widthPixels / 36;
        t.setPadding(p, p, p, p);
        t.setOnClickListener(v -> {
            if (showReading == reading) return;
            showReading = reading;
            getPreferences(MODE_PRIVATE).edit().putBoolean("reading", reading).apply();
            reload();
        });
        return t;
    }

    private void styleTabs() {
        for (TextView t : new TextView[]{tabBedtime, tabReading}) {
            boolean on = (t == tabReading) == showReading;
            t.setBackgroundColor(on ? Color.BLACK : Color.WHITE);
            t.setTextColor(on ? Color.WHITE : Color.BLACK);
        }
        tabSync.setTextColor(syncing ? Color.GRAY : Color.BLACK);
    }

    private void setNotice(String s) {
        notice.setText(s == null ? "" : s);
        notice.setVisibility(s == null ? View.GONE : View.VISIBLE);
    }

    /** Pull the shelf. A manual sync reports everything; the automatic one at launch only speaks up when something changed. */
    private void sync(boolean manual) {
        if (syncing) return;
        syncing = true; styleTabs();
        if (manual) setNotice("Syncing…");
        Sync.run(this, manual, (updated, message, error) -> {
            syncing = false; styleTabs();
            if (updated > 0) reload();
            setNotice(message);
            if (message != null && !error) notice.postDelayed(() -> setNotice(null), 4000);
        });
    }

    private void reload() {
        books.clear();
        for (Book b : Book.loadAll(Sync.booksDir(this))) if (b.reading == showReading) books.add(b);
        styleTabs();
        adapter.notifyDataSetChanged();
    }

    @Override protected void onResume() {
        super.onResume();
        reload();
    }

    private void open(Book b) {
        startActivity(new Intent(this, ReaderActivity.class).putExtra(ReaderActivity.EXTRA_DIR, b.dir.getAbsolutePath()));
        overridePendingTransition(0, 0);
    }

    private class CoverAdapter extends BaseAdapter {
        final int cellW;
        CoverAdapter(int cellW) { this.cellW = cellW; }
        @Override public int getCount() { return books.size(); }
        @Override public Object getItem(int i) { return books.get(i); }
        @Override public long getItemId(int i) { return i; }

        @Override public View getView(int i, View recycled, ViewGroup parent) {
            LinearLayout cell; ImageView img; TextView title;
            if (recycled instanceof LinearLayout) {
                cell = (LinearLayout) recycled; img = (ImageView) cell.getChildAt(0); title = (TextView) cell.getChildAt(1);
            } else {
                cell = new LinearLayout(LibraryActivity.this);
                cell.setOrientation(LinearLayout.VERTICAL);
                img = new ImageView(LibraryActivity.this);
                img.setScaleType(ImageView.ScaleType.FIT_CENTER);
                img.setBackgroundColor(Color.BLACK); img.setPadding(3, 3, 3, 3);   // thin black border
                cell.addView(img, new LinearLayout.LayoutParams(cellW, cellW * 4 / 3));
                title = new TextView(LibraryActivity.this);
                title.setTypeface(Typeface.SERIF); title.setTextColor(Color.BLACK); title.setTextSize(13);
                title.setGravity(Gravity.CENTER_HORIZONTAL); title.setMaxLines(2);
                title.setPadding(0, cellW / 20, 0, 0);
                cell.addView(title, new LinearLayout.LayoutParams(cellW, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            Book b = books.get(i);
            img.setImageBitmap(thumb(b.cover, cellW));
            title.setText(b.title);
            return cell;
        }

        private Bitmap thumb(File f, int targetW) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true; BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            int sample = 1; while (o.outWidth / (sample * 2) >= targetW) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options(); o2.inSampleSize = sample;
            return BitmapFactory.decodeFile(f.getAbsolutePath(), o2);
        }
    }
}
