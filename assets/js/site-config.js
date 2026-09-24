/* ---------------------------------------------------------------------------
   Runtime configuration for TerraHaul. Edited through /admin.html, or by hand.

   THIS FILE IS PUBLIC. Everything in it ships to every visitor.
   Payment Link URLs, business details and the admin hash are all fine to publish.
   A Stripe SECRET key (sk_live_... / sk_test_...) is NOT. Never put one here.
--------------------------------------------------------------------------- */
window.SITE_CONFIG = {
  // SHA-256 of the admin passphrase. This only hides the form from a casual
  // visitor -- anyone can read this file and bypass it. Nothing behind it is
  // secret; the real gate on changing the live site is your GitHub login.
  admin: { passHash: "5b9e9741342f4f8a87a03b52634853031e9478d49220cadd57e189392e0b7bb3" },

  // Shown in the footer of every page. Google and Stripe both verify these.
  business: {
    company:   "TerraHaul",
    companyNo: "",
    vatNo:     "",
    street:    "18 Markendale Place",
    city:      "Salford",
    postcode:  "",
    phone:     "+44 161 888 2309"
  },

  // Data collector that feeds the admin dashboard. Without it the dashboard
  // shows nothing rather than inventing figures. See stripe/README.md.
  analyticsEndpoint: "",

  // Optional: Checkout Sessions for baskets with more than one machine.
  checkoutEndpoint: "",

  // One Stripe Payment Link per machine. Blank = that machine routes to an
  // enquiry instead of pretending to take payment.
  paymentLinks: {
    "TH-CREX6M": "https://buy.stripe.com/5kQ9AT2Kiff00ck9nm6c00s",
    "TH-DP5000": "https://buy.stripe.com/fZu7sLdoWgj41go0QQ6c00t",
    "TH-TW1375G": "https://buy.stripe.com/00wdR998GeaWf7e4326c00u",
    "TH-360SW": "https://buy.stripe.com/eVq8wPacK6Iuf7eczy6c00v"
  }
};
