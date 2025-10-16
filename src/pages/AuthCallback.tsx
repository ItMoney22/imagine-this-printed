import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
);

export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign in…");
  const [detail, setDetail] = useState<string>("");
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href;
        console.log("[callback] href", href);

        const url = new URL(href);
        const hasCode = !!url.searchParams.get("code") || href.includes("#access_token=");

        if (!hasCode) {
          throw new Error("No auth code present in URL");
        }

        console.log("[callback] exchanging code for session…");
        const { data, error } = await supabase.auth.exchangeCodeForSession(href);
        if (error) throw error;
        console.log("[callback] exchange ok", !!data?.session);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No session after exchange");

        // confirm token stored
        const key = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        console.log("[callback] localStorage key:", key, "has token?", !!key && !!JSON.parse(localStorage.getItem(key) || "{}")?.currentSession?.access_token);

        setMsg("Signed in. Redirecting…");
        nav("/", { replace: true });
      } catch (err: any) {
        console.error("[callback] error:", err);
        setMsg("We couldn't complete sign in.");
        setDetail(err?.message || String(err));
      }
    })();
  }, [nav]);

  return (
    <div style={{ padding: "4rem", textAlign: "center" }}>
      <h2>{msg}</h2>
      {detail && <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{detail}</pre>}
    </div>
  );
}
