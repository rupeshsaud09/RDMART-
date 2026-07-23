// Fill these values from Supabase Project Settings > API.
// Keep this file unconfigured for local-only fallback mode.
// The small UMD wrapper lets the authenticated server-side test-summary
// endpoint reuse these PUBLIC values. Private/service-role keys never belong
// here and remain server environment variables only.
(function(root,factory){
  const config=factory();
  if(typeof module==='object'&&module.exports)module.exports=config;
  if(root)root.MARTAI_SUPABASE=config;
})(typeof window!=='undefined'?window:null,function(){
  return {
    url: 'https://kiodjzuqfftjnyyeyzxb.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpb2RqenVxZmZ0am55eWV5enhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MDcyMTIsImV4cCI6MjA5ODI4MzIxMn0.dsHdwYVoiSjUOE9iG876bDkdYrcAeTZuW4xhFforQyI',
    // 'tables' = real Supabase tables with per-store data and Supabase Auth login.
    // Requires setup-complete.sql to have been run once in the Supabase SQL Editor.
    // Only fall back to 'json' if Supabase is not set up at all.
    mode: 'tables'
  };
});
