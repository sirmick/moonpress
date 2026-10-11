package com.mick.nighttimebooks;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.MotionEvent;
import android.view.View;

/** Draws one page: full-bleed picture, a solid white text panel, and an optional close (x) button. */
public class PageView extends View {
    public interface TapListener { void onTap(float xFrac, float yFrac, boolean onClose); }

    private Bitmap bitmap; private String text = ""; private boolean textTop; private String word = ""; private boolean reading;
    private final TextPaint wordPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private Typeface readFont, readFontBold;
    private boolean showClose;
    private TapListener listener;

    private final Paint bmpPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final Paint panelFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint panelStroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint textPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final RectF closeRect = new RectF();

    public PageView(Context c) {
        super(c);
        panelFill.setColor(Color.WHITE);
        panelStroke.setColor(Color.BLACK); panelStroke.setStyle(Paint.Style.STROKE); panelStroke.setStrokeWidth(4f);
        textPaint.setColor(Color.BLACK);
        textPaint.setTypeface(Typeface.create(Typeface.SERIF, Typeface.NORMAL));
        wordPaint.setColor(Color.BLACK);
        try {
            readFont = Typeface.createFromAsset(c.getAssets(), "Andika-Regular.ttf");
            readFontBold = Typeface.createFromAsset(c.getAssets(), "Andika-Bold.ttf");
        } catch (Exception e) { readFont = Typeface.SANS_SERIF; readFontBold = Typeface.DEFAULT_BOLD; }
        wordPaint.setTypeface(readFontBold);
    }

    public void setListener(TapListener l) { listener = l; }

    public void setPage(Bitmap b, String t, boolean top, String w, boolean isReading) {
        if (bitmap != null && bitmap != b) bitmap.recycle();
        bitmap = b; text = t == null ? "" : t; textTop = top; word = w == null ? "" : w; reading = isReading;
        textPaint.setTypeface(reading ? readFont : Typeface.create(Typeface.SERIF, Typeface.NORMAL));
        showClose = false; invalidate();
    }

    public void setShowClose(boolean s) { if (showClose != s) { showClose = s; invalidate(); } }
    public boolean isShowClose() { return showClose; }

    @Override protected void onDraw(Canvas canvas) {
        int w = getWidth(), h = getHeight();
        canvas.drawColor(Color.WHITE);
        if (bitmap != null) {
            // Fill the view, cropping whichever dimension overflows (images are 3:4 like the panel).
            float scale = Math.max((float) w / bitmap.getWidth(), (float) h / bitmap.getHeight());
            int dw = Math.round(bitmap.getWidth() * scale), dh = Math.round(bitmap.getHeight() * scale);
            int dx = (w - dw) / 2, dy = (h - dh) / 2;
            canvas.drawBitmap(bitmap, null, new Rect(dx, dy, dx + dw, dy + dh), bmpPaint);
        }
        if (reading) drawReadingPanel(canvas, w, h);
        else if (!text.isEmpty()) drawPanel(canvas, w, h);
        if (showClose) drawClose(canvas, w);
    }

    private void drawPanel(Canvas canvas, int w, int h) {
        float band = h / 4f, m = w * 0.03f;          // panel lives in the top or bottom quarter
        RectF r = textTop ? new RectF(m, m, w - m, band - m * 0.6f) : new RectF(m, h - band + m * 0.6f, w - m, h - m);
        float pad = m * 1.2f;
        int innerW = (int) (r.width() - 2 * pad), innerH = (int) (r.height() - 2 * pad);
        // Largest text size (in px) whose layout fits the panel; ~28sp at 300 dpi down to ~20sp.
        StaticLayout layout = null;
        for (float size = w * 0.05f; size >= w * 0.034f; size -= 2f) {
            textPaint.setTextSize(size);
            layout = StaticLayout.Builder.obtain(text, 0, text.length(), textPaint, innerW)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER).setLineSpacing(0f, 1.2f).build();
            if (layout.getHeight() <= innerH) break;
        }
        canvas.drawRoundRect(r, m, m, panelFill);
        canvas.drawRoundRect(r, m, m, panelStroke);
        canvas.save();
        canvas.translate(r.left + pad, r.top + pad + (innerH - layout.getHeight()) / 2f);
        layout.draw(canvas);
        canvas.restore();
    }

    /** Learning-to-read panel: the new word very big, the sentence big, panel grows to fit (max ~42% of the screen). */
    private void drawReadingPanel(Canvas canvas, int w, int h) {
        float m = w * 0.03f, pad = m * 0.96f;             // padding 20% tighter than bedtime panels
        float boxW = (w - 2 * m) * 0.8f;                  // box 20% narrower, centred
        float left = (w - boxW) / 2f;
        int innerW = (int) (boxW - 2 * pad);
        float maxInner = h * 0.42f - 2 * pad - m;
        StaticLayout wl = null, tl = null; float gap = 0;
        for (float scale = 1f; scale >= 0.5f; scale -= 0.05f) {
            float textSize = w * 0.064f * scale;             // ~68 px at 1072 wide: sentence
            wordPaint.setTextSize(w * 0.102f * scale);       // ~110 px: the new word
            textPaint.setTextSize(textSize);
            wl = word.isEmpty() ? null : StaticLayout.Builder.obtain(word, 0, word.length(), wordPaint, innerW)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER).setIncludePad(false).build();
            tl = text.isEmpty() ? null : StaticLayout.Builder.obtain(text, 0, text.length(), textPaint, innerW)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER).setLineSpacing(0f, 1.15f).setIncludePad(false).build();
            gap = (wl != null && tl != null) ? textSize * 0.35f : 0;
            float need = (wl == null ? 0 : wl.getHeight()) + gap + (tl == null ? 0 : tl.getHeight());
            if (need <= maxInner) break;
        }
        float inner = (wl == null ? 0 : wl.getHeight()) + gap + (tl == null ? 0 : tl.getHeight());
        if (inner <= 0) return;
        RectF r = new RectF(left, h - m - inner - 2 * pad, left + boxW, h - m);
        canvas.drawRoundRect(r, m, m, panelFill);
        canvas.drawRoundRect(r, m, m, panelStroke);
        canvas.save();
        canvas.translate(r.left + pad, r.top + pad);
        if (wl != null) { wl.draw(canvas); canvas.translate(0, wl.getHeight() + gap); }
        if (tl != null) tl.draw(canvas);
        canvas.restore();
    }

    private void drawClose(Canvas canvas, int w) {
        float s = w * 0.11f, m = w * 0.03f;
        closeRect.set(m, m, m + s, m + s);
        canvas.drawRoundRect(closeRect, s / 2, s / 2, panelFill);
        canvas.drawRoundRect(closeRect, s / 2, s / 2, panelStroke);
        Paint x = new Paint(panelStroke); x.setStrokeWidth(6f); x.setStrokeCap(Paint.Cap.ROUND);
        float in = s * 0.3f;
        canvas.drawLine(closeRect.left + in, closeRect.top + in, closeRect.right - in, closeRect.bottom - in, x);
        canvas.drawLine(closeRect.right - in, closeRect.top + in, closeRect.left + in, closeRect.bottom - in, x);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getAction() == MotionEvent.ACTION_UP && listener != null) {
            // Generous hit area around the close button.
            boolean onClose = showClose && e.getX() <= closeRect.right + closeRect.width() && e.getY() <= closeRect.bottom + closeRect.height();
            listener.onTap(e.getX() / getWidth(), e.getY() / getHeight(), onClose);
        }
        return true;
    }
}
