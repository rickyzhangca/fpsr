// jsdom does not implement Element.getAnimations, which Base UI Scroll Area uses.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

// jsdom does not implement Element.scrollIntoView.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
