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
        // For PKCE flow, exchange the code for a session
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (code) {
          // PKCE flow - exchange code for session
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        // For implicit flow (hash-based), the client auto-detects with detectSessionInUrl: true
        // Just verify a session exists
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
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
