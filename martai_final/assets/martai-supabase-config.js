// Fill these values from Supabase Project Settings > API.
// Keep this file unconfigured for local-only fallback mode.
window.MARTAI_SUPABASE = {
  url: 'https://kiodjzuqfftjnyyeyzxb.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpb2RqenVxZmZ0am55eWV5enhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MDcyMTIsImV4cCI6MjA5ODI4MzIxMn0.dsHdwYVoiSjUOE9iG876bDkdYrcAeTZuW4xhFforQyI',
  // 'tables' = real Supabase tables with per-store data and Supabase Auth login.
  // Requires setup-complete.sql to have been run once in the Supabase SQL Editor.
  // Only fall back to 'json' if Supabase is not set up at all.
  mode: 'tables'
};
