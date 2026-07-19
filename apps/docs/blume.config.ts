import { defineConfig } from "blume";

export default defineConfig({
  title: "fpsr",
  description: "Factorio 2.1.11 blueprint-string renderer for browser and Node.js.",
  github: {
    owner: "rickyzhangca",
    repo: "fpsr",
  },
  deployment: {
    site: "https://fpsr-docs.fprints.xyz",
  },
  navigation: {
    tabs: [
      { label: "Guide", path: "/guide", icon: "book-open" },
      { label: "API", path: "/api", icon: "code" },
      { label: "Project", path: "/project", icon: "layers" },
    ],
    featured: [
      {
        label: "Open viewer",
        href: "https://fpsr.fprints.xyz",
        icon: "external-link",
      },
    ],
  },
  seo: {
    og: { enabled: true },
    sitemap: true,
    robots: true,
  },
  analytics: {
    scripts: [
      {
        src: "https://www.googletagmanager.com/gtag/js?id=G-W2STQT8FQE",
        strategy: "async",
      },
      {
        content: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-W2STQT8FQE');
`,
      },
    ],
  },
  redirects: [{ from: "/", to: "/guide", status: 301 }],
});
