const { createClient } = require('@supabase/supabase-js');

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getSupabaseAnon(jwt) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars not configured');
  }
  return createClient(url, key, {
    global: {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserFromJwt(jwt) {
  if (!jwt) return null;
  const sb = getSupabaseAnon(jwt);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// CORS helper for Netlify functions
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}

module.exports = {
  getSupabaseAdmin,
  getSupabaseAnon,
  getUserFromJwt,
  corsHeaders,
};