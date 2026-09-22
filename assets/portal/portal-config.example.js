// IRICO DICOM portal - client-side config.
// Copy to portal-config.js and fill in your Supabase project values.
window.PORTAL_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLISHABLE-KEY',
  VIEWER_BASE: '/dicom-viewer',
  TOKEN_URL: '/.netlify/functions/get-viewer-token',
};