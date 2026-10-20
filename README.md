# GCalc (GWA Calculator app)

GWA calculator for CLSU students, packaged as an app you can install:

- **Android:** a real APK (works offline, no internet needed).
- **iPhone:** an installable web app (Safari > Share > Add to Home Screen). It opens full screen with its own icon and also works offline.

Ported from Aaron Jay Gabato's web version: https://aaronjay30.github.io/gwa-calculator/

## Install on Android

1. Open this repo's **Releases** page on your phone and download `GCalc.apk` from the latest release.
2. Open the file. If Android asks, allow your browser or file manager to "Install unknown apps".
3. Open **GCalc** from your home screen.

## Install on iPhone

1. Open the web app link (GitHub Pages, shown under the repo's **About** / **Deployments**) in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.

## How it computes

`GWA = sum(grade x units) / sum(units)`, rounded to 4 decimals. Only rows that have both a grade and units are counted.

Honors (only when total units are more than 10):

| GWA | Standing |
| --- | --- |
| 1.50 and below | University Scholar |
| above 1.50 up to 1.75 | College Scholar |
| above 1.75 up to 2.00 | Dean's Lister |

Grades, subject names and the theme are saved on the phone, so they are still there next time you open the app.

## Using it

- Tap **Add subject**, pick a grade and units (3 is selected by default), and optionally type a name. Tap **Next subject** to enter the next one right away, or **Done** when finished.
- Tap any subject in the list to change it or delete it.
- Removing a subject or tapping **Clear all** shows an **Undo** button for a few seconds.
- When you scroll down a long list, a bar at the top keeps showing your GWA.

## Project layout

```
www/                 The calculator itself (HTML, CSS, JS). Used by both versions.
android/             Android app that bundles www/ inside a WebView.
.github/workflows/   Builds the APK and publishes the web app on every push to main.
```

## Building

The APK is built automatically by GitHub Actions on every push to `main` (see the **Actions** tab). To build on your own computer instead, install Android Studio, open the `android/` folder, and run **Build > Build APK(s)**, or from a terminal:

```
cd android
./gradlew assembleRelease
```

The web app needs no build step: serve the `www/` folder with any static web server.

**GitHub Pages:** if the "Web app" job fails the first time, go to **Settings > Pages** and set **Source** to **GitHub Actions**, then re-run the workflow.

### Keeping updates installable (optional)

Android only installs an update over an existing app if both are signed with the same key. Add these repository secrets (**Settings > Secrets and variables > Actions**) to sign every build with your own key:

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | your `.jks` keystore, base64-encoded |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | key alias |
| `KEY_PASSWORD` | key password |

Without them, builds are signed with a temporary key and you may need to uninstall the old version before installing a new one.

## Credits

See [NOTICE.md](NOTICE.md).
