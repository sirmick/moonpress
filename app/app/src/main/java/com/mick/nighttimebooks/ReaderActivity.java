package com.mick.nighttimebooks;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import java.io.File;

/** One book. Left third = back, right third = forward, middle = show/hide the close button. */
public class ReaderActivity extends Activity {
    public static final String EXTRA_DIR = "dir";
    private Book book; private int index; private PageView view;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        book = Book.load(new File(getIntent().getStringExtra(EXTRA_DIR)));
        if (book == null) { finish(); return; }
        index = saved == null ? 0 : saved.getInt("index", 0);
        view = new PageView(this);
        view.setListener(this::onTap);
        setContentView(view);
        hideSystemBars();
        show();
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putInt("index", index); }

    private void hideSystemBars() {
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.hide(WindowInsets.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    private void show() {
        Book.Page p = book.pages.get(index);
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap b = BitmapFactory.decodeFile(p.image.getAbsolutePath(), o);
        view.setPage(b, p.text, p.textTop, p.word, book.reading);
    }

    private void onTap(float x, float y, boolean onClose) {
        if (onClose) { finish(); return; }
        if (view.isShowClose()) { view.setShowClose(false); return; }   // any other tap just dismisses the x
        if (x < 1f / 3f) {
            if (index > 0) { index--; show(); }
        } else if (x > 2f / 3f) {
            if (index < book.pages.size() - 1) { index++; show(); } else finish();   // past the last page -> library
        } else {
            view.setShowClose(true);
        }
    }

    @Override public void finish() { super.finish(); overridePendingTransition(0, 0); }
}
