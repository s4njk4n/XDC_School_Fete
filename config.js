/*
 * Fete Tickets — site-wide settings.
 * ------------------------------------------------------------
 * You do NOT need to edit this file to run a fete. Every school sets up its
 * own fete from the Organiser app; the fete travels inside the links and QR
 * codes the app creates (…/customer/?fete=0x…), and inside everyone's backup
 * message. One copy of this website serves any number of schools.
 *
 * These values are just defaults for whoever hosts the site.
 */
window.FETE_CONFIG = {
  // Optional: pin a single fete for every visitor. Leave "" (recommended) so any school can use the site.
  feteAddress: "",

  // Connection server used by every app. Phones can change it under Settings.
  defaultRpc: "https://rpc.plugin.global/xdcmainnet",

  // Currency symbol shown next to money amounts.
  currency: "$",

  // Running credit (XDC) automatically passed along so phones can pay.
  customerCredit: "0.05",        // added to a customer's phone when they buy tickets...
  customerCreditBelow: "0.01",   // ...but only if their phone has less than this
  stallCredit: "0.5",            // suggested credit for each stall (used for refunds)
  boothCredit: "10",             // suggested credit for each ticket booth phone

  // Shown in the footer of every app.
  builtBy: "XDC Outpost",
  builtByUrl: "https://xdcoutpost.xyz"
};
