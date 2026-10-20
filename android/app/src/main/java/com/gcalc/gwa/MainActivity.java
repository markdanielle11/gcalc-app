package com.gcalc.gwa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * GCalc: hosts the bundled calculator in a WebView.
 * The files in assets/ are served from https://appassets.androidplatform.net/
 * (handled entirely inside the app, nothing goes to the internet) so that the
 * offline text reader used by "Import" can start its background worker.
 */
public class MainActivity extends Activity {

    private static final String TAG = "GCalc";
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";
    private static final String SELFTEST_URL = "https://" + ASSET_HOST + "/selftest.html";
    private static final String PREFS = "gcalc";
    private static final String PREF_DARK = "dark";
    private static final int DARK_BG = Color.parseColor("#131B31");
    private static final int LIGHT_BG = Color.parseColor("#EEF2FB");
    private static final int REQUEST_FILE = 41;
    private static final int REQUEST_SAVE = 42;

    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private TextRecognizer textRecognizer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setUpEdgeToEdge();

        boolean dark = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_DARK, true);
        applyTheme(dark);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // saves grades and theme between launches
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);

        webView.setVerticalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new Bridge(), "GCalcAndroid");
        webView.setWebViewClient(new AppClient());
        webView.setWebChromeClient(new ChromeClient());

        boolean selftest = getIntent() != null && getIntent().getBooleanExtra("selftest", false);
        if (savedInstanceState != null && !selftest) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(selftest ? SELFTEST_URL : START_URL);
        }
    }

    /** Serves files from assets/ for the app's own address; opens everything else in the browser. */
    private class AppClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (ASSET_HOST.equals(uri.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                // No browser installed; nothing to do.
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"https".equals(uri.getScheme()) || !ASSET_HOST.equals(uri.getHost())) {
                return null;
            }
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (path.startsWith("/")) path = path.substring(1);
            if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(path);
                String mime = mimeType(path);
                boolean text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")
                        || mime.endsWith("svg+xml") || mime.endsWith("manifest+json");
                WebResourceResponse response = new WebResourceResponse(mime, text ? "UTF-8" : null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("Access-Control-Allow-Origin", "*");
                response.setResponseHeaders(headers);
                return response;
            } catch (IOException e) {
                return notFound();
            }
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeType(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    /** Lets the page pick an image (Import) and logs page messages for debugging. */
    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(null);
            }
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            // Screenshots for Import; any file for restoring a backup (.json has no
            // reliable type on Android, so it isn't filtered).
            boolean images = false;
            for (String type : params.getAcceptTypes()) {
                if (type != null && type.startsWith("image")) images = true;
            }
            intent.setType(images ? "image/*" : "*/*");
            try {
                startActivityForResult(Intent.createChooser(intent, null), REQUEST_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.i(TAG, message.message());
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_SAVE) {
            boolean ok = false;
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && bytes != null) {
                try (java.io.OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (out != null) {
                        out.write(bytes);
                        ok = true;
                    }
                } catch (IOException e) {
                    Log.w(TAG, "save failed", e);
                }
            }
            final String js = "window.GCalcSaved && window.GCalcSaved(" + (resultCode == RESULT_OK ? String.valueOf(ok) : "null") + ")";
            webView.post(() -> webView.evaluateJavascript(js, null));
            return;
        }
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** Draw behind the status and navigation bars and pad the content so nothing sits under them. */
    private void setUpEdgeToEdge() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            window.setNavigationBarContrastEnforced(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    /** Match the bars and background to the calculator's dark or light theme. */
    private void applyTheme(boolean dark) {
        int bg = dark ? DARK_BG : LIGHT_BG;
        root.setBackgroundColor(bg);
        webView.setBackgroundColor(bg);
        Window window = getWindow();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                light |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(dark ? (flags & ~light) : (flags | light));
        }
    }

    /** Called from the page (app.js / ocr.js). */
    private class Bridge {
        @JavascriptInterface
        public void setTheme(final boolean dark) {
            SharedPreferences.Editor editor = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
            editor.putBoolean(PREF_DARK, dark).apply();
            runOnUiThread(() -> applyTheme(dark));
        }

        @JavascriptInterface
        public boolean nativeTextAvailable() {
            return true;
        }

        /** Asks where to save a file (a backup), then writes it. Reports to window.GCalcSaved(ok). */
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            runOnUiThread(() -> {
                pendingSave = Base64.decode(base64, Base64.DEFAULT);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(intent, REQUEST_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    webView.evaluateJavascript("window.GCalcSaved && window.GCalcSaved(false)", null);
                }
            });
        }

        /** Opens the share sheet with a picture of the GWA. */
        @JavascriptInterface
        public void shareImage(final String base64) {
            try {
                java.io.File dir = new java.io.File(getCacheDir(), "share");
                if (!dir.isDirectory() && !dir.mkdirs()) return;
                java.io.File file = new java.io.File(dir, "my-gwa.png");
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) {
                    out.write(Base64.decode(base64, Base64.DEFAULT));
                }
                final Uri uri = Uri.parse("content://" + ShareProvider.AUTHORITY + "/my-gwa.png");
                runOnUiThread(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("image/png");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    send.setClipData(android.content.ClipData.newRawUri("", uri));
                    try {
                        startActivity(Intent.createChooser(send, null));
                    } catch (ActivityNotFoundException e) {
                        Log.w(TAG, "no app to share with", e);
                    }
                });
            } catch (IOException e) {
                Log.w(TAG, "share failed", e);
            }
        }

        /**
         * Reads the text in an image with Google ML Kit (on the phone, no internet).
         * The result goes back to window.GCalcNativeText(id, layout, error).
         */
        @JavascriptInterface
        public void recognizeText(final String requestId, final String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                // Huge images (long scrolling screenshots, camera photos): decode at a
                // reduced size so the app can't run out of memory.
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = 1;
                while ((long) (bounds.outWidth / opts.inSampleSize) * (bounds.outHeight / opts.inSampleSize) > 16_000_000L) {
                    opts.inSampleSize *= 2;
                }
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                if (bitmap == null) {
                    deliverText(requestId, null, "That file could not be opened as an image.");
                    return;
                }
                // Small screenshots: enlarge so letters are big enough to read well.
                float scale = Math.min(3f, 1600f / Math.max(1, bitmap.getWidth()));
                scale = Math.min(scale, (float) Math.sqrt(16_000_000.0 / ((double) bitmap.getWidth() * bitmap.getHeight())));
                if (scale > 1.05f) {
                    bitmap = Bitmap.createScaledBitmap(bitmap,
                            Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
                }
                final int width = bitmap.getWidth();
                final int height = bitmap.getHeight();
                if (textRecognizer == null) {
                    textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                }
                textRecognizer.process(InputImage.fromBitmap(bitmap, 0))
                        .addOnSuccessListener(text -> {
                            try {
                                deliverText(requestId, layoutJson(text, width, height), null);
                            } catch (JSONException e) {
                                deliverText(requestId, null, "Could not read the result.");
                            }
                        })
                        .addOnFailureListener(e -> deliverText(requestId, null, String.valueOf(e.getMessage())));
            } catch (Throwable t) {
                deliverText(requestId, null, String.valueOf(t.getMessage()));
            }
        }
    }

    private static JSONArray boxJson(Rect r) throws JSONException {
        JSONArray a = new JSONArray();
        if (r == null) return a;
        a.put(r.left);
        a.put(r.top);
        a.put(r.right);
        a.put(r.bottom);
        return a;
    }

    private static String layoutJson(Text text, int width, int height) throws JSONException {
        JSONArray lines = new JSONArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                JSONObject l = new JSONObject();
                l.put("text", line.getText());
                l.put("box", boxJson(line.getBoundingBox()));
                JSONArray elements = new JSONArray();
                for (Text.Element element : line.getElements()) {
                    if (element.getBoundingBox() == null) continue;
                    JSONObject e = new JSONObject();
                    e.put("text", element.getText());
                    e.put("box", boxJson(element.getBoundingBox()));
                    elements.put(e);
                }
                l.put("elements", elements);
                lines.put(l);
            }
        }
        JSONObject out = new JSONObject();
        out.put("width", width);
        out.put("height", height);
        out.put("lines", lines);
        return out.toString();
    }

    private void deliverText(final String requestId, final String layoutJson, final String error) {
        final String js = "window.GCalcNativeText && window.GCalcNativeText("
                + JSONObject.quote(requestId) + ","
                + (layoutJson == null ? "null" : layoutJson) + ","
                + JSONObject.quote(error == null ? "" : error) + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (textRecognizer != null) {
            textRecognizer.close();
        }
        if (webView != null) {
            webView.removeJavascriptInterface("GCalcAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
