import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "lord-icon": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        trigger?: string;
        state?: string;
        colors?: string;
      };
    }
  }
}

export {};