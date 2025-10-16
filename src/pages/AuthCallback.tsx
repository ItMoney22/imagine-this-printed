import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let canceled = false;

    (async () => {
      try {
        // Handles both hash (#access_token=...) and code (PKCE) flows.
        const hashHasToken = typeof window !== "undefined" && window.location.hash.includes("access_token");
        const urlHasCode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("code");

        if (hashHasToken || urlHasCode) {
          const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
          if (error) throw error;
        }

        // Double-check a session exists
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("No session after callback");

        if (!canceled) navigate("/", { replace: true });
      } catch (e: any) {
        if (!canceled) setErr(e?.message || String(e));
      }
    })();

    return () => { canceled = true; };
  }, [navigate]);

  return (
    <div style={{minHeight:"60vh", display:"grid", placeItems:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:32,height:32,border:"4px solid #a855f7",borderTopColor:"transparent",borderRadius:"9999px",margin:"0 auto 12px",animation:"spin 1s linear infinite"}} />
        <p>Completing sign in...</p>
        {err && <p style={{color:"#ef4444",marginTop:8}}>Error: {err}</p>}
      </div>
    </div>
  );
}
