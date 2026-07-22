// Daily-summary push notifications: public VAPID key only (safe to expose,
// same idea as the Supabase anon key). The matching PRIVATE key lives only
// in the server's VAPID_PRIVATE_KEY environment variable — never here.
// Leave vapidPublicKey empty to keep the "Daily summary on your phone"
// feature hidden until it has been configured.
window.MARTAI_PUSH = {
  vapidPublicKey: 'BJ7Q8KoG-SISi8aR4yEVj3TMfJdRxU19iWyZenIEPwPa_ksIqBevOSmCwM_9NDUsupd7ZIq5Q8pZKEBX4F3gpZA'
};
