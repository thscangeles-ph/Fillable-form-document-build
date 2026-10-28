# THSC Cardiac Rehab Forms

A tablet-friendly web app for The Heart Specialists Clinic and Diagnostic Center's
Cardiac Rehabilitation Program. Staff fill in each patient's forms on screen, the
patient signs on the tablet, and **Download Word** produces the clinic's own Word
template with everything filled in.

Forms (one tab each):

| Tab | What it does |
| --- | --- |
| Informed Consent | Consent text, program schedule, participant and witness signatures |
| DASI | 12 Yes/No questions; total, estimated peak VO2 and METs are calculated |
| 6 Minute Walk | Baseline / end-of-test vitals; total distance = laps × lap length (10 m or 20 m) + partial lap |
| Treatment Plan | Indications, co-morbidities, exam (BMI calculated), GAD-2 and PHQ-2 totals |
| Exercise Sessions | Sessions 1–12: calisthenics, treadmill, bicycle vitals, Borg scale, symptoms, discharge vitals |
| HEART-SHIELD | Heart failure vaccination eligibility checklist (`panels/heart-shield.html`, shown as-is). Its answers are not saved with the patient or put in the Word file; use its Print / Save as PDF or Copy assessment |

Patient name, age, sex, birthday and enrollment date are entered once and appear on every form.

**Signatures** save as soon as they are drawn. **Finalize signature** locks one for good:
it can no longer be redrawn, cleared or re-dated.

**Program status** (In program / Completed / Dropped out) is set on each patient's page.
If it is left alone, a patient counts as Completed once all 12 sessions have a date.
Choosing Dropped out shows a **Dropout reason** list and a details box.

**Dashboard** summarizes every patient on the device, optionally limited to an enrollment
date range: total enrolled (male / female), average age (male / female), completed,
dropped out (with a count per dropout reason), hypertension (ticked under Co-morbidities
in the Treatment Plan, with male / female), and average 6MWD at enrollment and end of program. *Export CSV* saves the
patient table for Excel. 6MWD at enrollment uses the Treatment Plan's *Initial* value,
or the 6 Minute Walk result when that is blank.

## Installing on a tablet

Live app: https://thsc-cardiac-rehab-forms.vercel.app

It installs as an app with its own home-screen icon, opens full-screen, and keeps
working without internet (Download Word included).

- **Android tablet / Chrome / Edge:** open the link and tap **Install app** on the
  Patients screen (or the browser menu → *Install app* / *Add to Home screen*).
- **iPad:** open the link in **Safari**, tap Share → **Add to Home Screen**.
- **Windows / Mac:** in Chrome or Edge, click the install icon in the address bar.

Updates install themselves the next time the app is opened while online.

## Installers (Windows PC and Android)

Besides the website, the app comes as installable programs that carry all their files,
so they work fully offline:

- **Windows:** `THSC-Cardiac-Rehab-Setup-<version>.exe` (Electron, in `desktop/`)
- **Android tablet / phone:** `THSC-Cardiac-Rehab-<version>.apk` (Capacitor, in `mobile/`)

Download them from the repository's **Releases** page.
- **Windows:** the installer isn't code-signed, so Windows may say "Windows protected your PC";
  click **More info → Run anyway**.
- **Android:** open the APK on the device and allow "Install unknown apps" when asked.

iPad and iPhone can't take an installer outside the App Store, so on Apple devices keep using
Safari → **Add to Home Screen**.

**Records are per app.** The Windows app, the Android app and the website each keep their own
records. Move them with Export/Share backup → Import backup.

### Building a release

Push a version tag; GitHub Actions builds both installers and publishes them:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

The Android build needs two repository secrets (Settings → Secrets and variables → Actions):
`ANDROID_KEYSTORE_BASE64` (the release keystore, base64) and `ANDROID_KEYSTORE_PASSWORD`.
Keep the keystore safe: Android only installs an update signed with the same key. Without the
secrets the Windows installer is still published.

To try the desktop app locally: `cd desktop && npm install && npm start`.

## Running it

It is a static site with no build step. Serve the folder over HTTP (opening
`index.html` as a file will not work, because the app fetches the Word template):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works the same way (Vercel, Netlify, GitHub Pages, a clinic intranet server).

## Sharing records between devices

Each device keeps its own records. To copy them to another tablet or phone:

1. On the device with the records, tap **Share backup** on the Patients screen and pick
   **Bluetooth**, Quick Share, AirDrop or email. (Where sharing is not available, use
   **Export backup** and send the downloaded file yourself.)
2. On the receiving device, open the app and tap **Import backup**, then choose the file
   (on Android, Bluetooth files land in *Downloads* or *Downloads › Bluetooth*).

Importing merges: new patients are added, and for a patient on both devices the more
recently edited copy wins. A finalized signature is never replaced or removed.

A web app cannot open a Bluetooth link to another phone by itself (browsers only let
web pages talk to Bluetooth accessories, and Safari not at all), so the transfer goes
through the device's own share menu.

## Where the data lives

Patient records are saved automatically in the browser's IndexedDB **on the device
being used**. Nothing is sent to a server. This means:

- Records on one tablet are not visible on another device.
- Clearing the browser's site data deletes them.
- Use **Export backup** on the Patients screen to save a JSON copy, and **Import backup** to restore it or move records to another device.

The downloaded Word file is the record to keep in the patient's chart.

## How Download Word works

`template/THSC_Cardiac_Rehab_Forms_BLANK.dotx` is the original Word template. Each
input in the app is keyed by the tag of a content control in that template
(`pt_name`, `dasi_yes_3`, `s07_tm_post_hr`, …). `js/template.js`:

1. reads the template's content controls (and each dropdown's allowed values),
2. writes each value into its control, leaving the file still editable in Word,
3. updates the custom XML part that the patient-detail controls are bound to,
4. embeds the signatures as images on their signature lines,
5. removes the template's SAVE PATIENT FILE / CALCULATE macro buttons — a `.dotx`
   cannot contain macros, and the app now does those calculations itself,
6. saves the result as a normal `.docx` named `PATIENT NAME - MM-DD-YYYY.docx`.

To change the paper form, edit the template in Word and keep the content-control
tags the same; the app picks up changed dropdown options automatically.

## Files

```
index.html            app shell
css/app.css           styles
js/app.js             routing, patient list, patient page, save / download / delete
js/forms.js           the five tabs, the calculations and program status
js/dashboard.js       dashboard figures, patient table and CSV export
js/template.js        reads and fills the Word template
js/signature.js       signature pad
js/store.js           IndexedDB storage
js/install.js         install button, service worker registration, persistent storage
js/native.js          saving and sharing files inside the Android app
css/fonts.css         bundled Fraunces and Lexend fonts (assets/fonts, SIL OFL)
desktop/              Windows app (Electron) and installer settings
mobile/               Android app (Capacitor); android/ is the Gradle project
scripts/copy-web.mjs  copies the web app into desktop/app and mobile/www
.github/workflows/    builds the installers on version tags
sw.js                 offline cache (bump VERSION when its file list changes)
manifest.webmanifest  app name, icons, full-screen display
template/             the Word template
panels/               stand-alone pages shown in a tab (HEART-SHIELD checklist)
vendor/jszip.min.js   JSZip 3.10.1 (MIT), for reading/writing .docx
tests/e2e.mjs         browser test: fills every tab, downloads and checks the .docx
```

## Testing

```bash
NODE_PATH=$(npm root -g) node tests/e2e.mjs   # needs Playwright + Chromium and python3
```
