// Any page can open the shop chat (MrImagineChatWidget listens). The Contact page's "Chat with us" door and the
// help page's "Still have a question?" strip use it, so there is one chat, not a second one per page.
export const OPEN_SHOP_CHAT = 'itp:open-shop-chat'

export interface OpenShopChatDetail {
  /** Start the hand-off to a person right away. */
  talkToPerson?: boolean
}

export function openShopChat(detail: OpenShopChatDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenShopChatDetail>(OPEN_SHOP_CHAT, { detail }))
}
