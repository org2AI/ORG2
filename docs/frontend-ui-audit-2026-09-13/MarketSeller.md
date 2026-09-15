# Seller account connection UI

Changed surface: MarketConnect SellerDialog, ConnectionHost and sellerLink.

- Shared Button and Modal are used; no raw action elements, custom sizes or colors.
- Dialog status has a polite live region; cancellation uses the same action on
  close/Escape and footer. No credential or callback data is displayed.
- Status is a bounded singleton external store. Subscribers dispose on unmount;
  there is no polling. One pending callback may queue only during browser opening.
- One native enrollment task owns the fixed-port receiver. Callback, timeout,
  cancellation and receiver drop close it. Network requests have fixed destinations,
  deadlines and bounded bodies. The native owner guard clears state on task drop.
- New dialog keys exist in all 13 locale dictionaries.

Component tests cover invalid destination, duplicate callback, binding failure and
cancellation. Native receiver tests cover timeout, invalid state, replay and drop.
Chrome on macOS opened the isolated ORG2 acceptance build, rendered the seller
approval modal, and cancellation dismissed it. The production approval page
currently returns a not-found page, so the provider round trip remains unverified.
The normal ORG2 URL handler was restored after acceptance.
