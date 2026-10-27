// Differences when running inside the installed Windows (Electron) or Android (Capacitor) apps.

export const isAndroidApp = () => !!window.Capacitor?.isNativePlatform?.();
export const isDesktopApp = () => navigator.userAgent.includes('Electron');

const plugins = () => window.Capacitor.Plugins;
const FOLDER = 'THSC Cardiac Rehab';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Android's WebView ignores <a download>, so files are written with the Filesystem plugin.
// Returns a short description of where the file went.
export async function saveFileAndroid(blob, filename) {
  const { Filesystem } = plugins();
  const data = await toBase64(blob);
  try {
    await Filesystem.writeFile({ path: `${FOLDER}/${filename}`, data, directory: 'DOCUMENTS', recursive: true });
    return `Saved to Documents › ${FOLDER}`;
  } catch {
    // Older Android versions need a storage permission for Documents; fall back to the share sheet.
    await shareFileAndroid(blob, filename);
    return 'Choose where to save it';
  }
}

export async function shareFileAndroid(blob, filename, title = filename) {
  const { Filesystem, Share } = plugins();
  const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: 'CACHE' });
  await Share.share({ title, files: [uri] });
}
