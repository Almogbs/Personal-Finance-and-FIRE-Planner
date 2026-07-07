export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return corsResponse(new Response(null, { status: 204 }));
  }

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return jsonResponse({ error: "Missing Google ID token" }, 401);
  }

  let claims;
  try {
    claims = await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID);
  } catch (error) {
    return jsonResponse({ error: error.message || "Google token verification failed" }, 401);
  }

  if (!claims || !claims.sub) {
    return jsonResponse({ error: "Invalid Google token payload" }, 401);
  }

  const userKey = `plan:${claims.sub}`;

  if (url.pathname === "/plan") {
    if (request.method === "GET") {
      const stored = await env.PLANS.get(userKey);
      if (!stored) {
        return jsonResponse({ error: "No plan found for this user" }, 404);
      }
      return jsonResponse({ plan: JSON.parse(stored) });
    }

    if (request.method === "PUT") {
      let payload;
      try {
        payload = await request.json();
      } catch (error) {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }

      if (!payload || payload.plan == null) {
        return jsonResponse({ error: "Missing plan JSON payload" }, 400);
      }

      await env.PLANS.put(userKey, JSON.stringify(payload.plan));
      return jsonResponse({ ok: true, storedAt: new Date().toISOString() });
    }
  }

  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "finance-planner-worker" });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

async function verifyGoogleToken(token, expectedAudience) {
  if (!expectedAudience) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }

  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", token);

  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error("Google rejected the ID token");
  }

  const payload = await response.json();
  if (payload.aud !== expectedAudience) {
    throw new Error("Google token audience mismatch");
  }
  if (payload.email_verified !== "true" && payload.email_verified !== true) {
    throw new Error("Google email is not verified");
  }

  return payload;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
