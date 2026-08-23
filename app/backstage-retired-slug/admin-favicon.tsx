"use client";

import { useEffect } from "react";

const ADMIN_FAVICON = "/admin-favicon.svg?v=admin-hm-red-2";

export default function AdminFavicon() {
  useEffect(() => {
    const selector = 'link[rel~="icon"]';
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.sizes = "any";
    icon.href = ADMIN_FAVICON;
    icon.dataset.hackmusicAdminIcon = "true";

    const enforceAdminIcon = () => {
      document.head.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
        if (link.dataset.hackmusicAdminIcon !== "true") link.remove();
      });
      if (!icon.isConnected) document.head.appendChild(icon);
    };

    enforceAdminIcon();
    const observer = new MutationObserver(enforceAdminIcon);
    observer.observe(document.head, { childList: true });

    return () => {
      observer.disconnect();
      icon.remove();
    };
  }, []);

  return null;
}
