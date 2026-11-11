package pro.kimliksiz.kantinsim;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * KantinSim Android kabuğu.
 *
 * Oyun statik dosyalardan oluşur; bu sınıf yalnız onu tam ekran bir WebView'de açar.
 * Ağ izni istenmez: index.html ve bütün varlıklar APK'nın içinden (file:///android_asset) gelir.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/index.html";
    private WebView web;
    /** Son geri tuşu basışının zamanı (ms); çift basışla çıkmak için kullanılır. */
    private long lastBack;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF1A110C);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) { return true; }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        // Çevrimdışı oyun: önbellek kullanılabilir, ama ağdan içerik çekilmez.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient());
        setContentView(web);
        hideSystemBars();
        web.loadUrl(START_URL);
    }

    /** Tam ekran: durum ve gezinme çubukları gizlenir, kenardan kaydırınca geçici olarak gelir. */
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    /** Odak geri gelince çubuklar yine gizlenir (bildirim çekme, geri tuşu vb. sonrası). */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /**
     * Geri tuşu: açık panel varsa kapatır. Panel yoksa iki kez basılmadıkça çıkılmaz;
     * ilk basışta kısa bir uyarı gösterilir, 2 saniye içinde ikinci basışta oyun kapanır.
     */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
                "(function(){var u=window.KS&&window.KS.ui;"
                        + "if(u&&u.isOpen&&u.isOpen()){u.close();return 'panel';}return 'cik';})()",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.contains("cik")) {
                            long now = System.currentTimeMillis();
                            if (now - lastBack < 2000) {
                                finish();
                            } else {
                                lastBack = now;
                                Toast.makeText(MainActivity.this,
                                        "Çıkmak için tekrar geri'ye bas", Toast.LENGTH_SHORT).show();
                            }
                        }
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        // Oyun kendi otomatik kaydını yapar; burada yalnız WebView duraklatılır.
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
