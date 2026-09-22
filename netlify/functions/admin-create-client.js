const { getSupabaseAdmin, getUserFromJwt, corsHeaders } = require('./_shared');

// Admin creates a new client and optionally a client login account.
// Body: { name, slug?, email?, password? }
//   name     - required, client display name
//   email+password - optional; if given, creates a client user whose
//                    app_metadata.client_id = new client id, role = 'client'
exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await getUserFromJwt(jwt);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if ((user.app_metadata || {}).role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin only' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const { name, email, password } = body;
  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name required' }) };
  }

  const admin = getSupabaseAdmin();

  const slug = (body.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .insert({ name, slug })
    .select()
    .single();

  if (clientErr) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: clientErr.message }) };
  }

  let loginUser = null;
  if (email && password) {
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'client', client_id: client.id },
      user_metadata: { role: 'client', client_id: client.id },
    });
    if (authErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Client created but login failed: ${authErr.message}`, clientId: client.id }),
      };
    }
    loginUser = { id: authUser.id, email: authUser.email };
  }

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, client: { id: client.id, name: client.name, slug: client.slug }, loginUser }),
  };
};