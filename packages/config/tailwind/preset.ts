/** Shared Tailwind theme tokens for Prism (atmospheric, non-default palette). */
export const prismTailwindPreset = {
  theme: {
    extend: {
      colors: {
        prism: {
          ink: "#061018",
          deep: "#0a1c28",
          mist: "#9eb8c4",
          foam: "#e6f2f5",
          aurora: "#2ec4b6",
          ember: "#e07a3d",
          slate: "#1a3340",
        },
      },
      fontFamily: {
        display: ['"Syne"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"Figtree"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "prism-atmosphere":
          "radial-gradient(ellipse 80% 60% at 20% 10%, rgba(46,196,182,0.22), transparent 55%), radial-gradient(ellipse 70% 50% at 90% 20%, rgba(224,122,61,0.14), transparent 50%), linear-gradient(165deg, #061018 0%, #0a1c28 45%, #0d2430 100%)",
      },
    },
  },
};

export default prismTailwindPreset;
