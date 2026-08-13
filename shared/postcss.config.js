import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'

function legacyTailwindColors() {
  const rgbWithAlpha = /rgb\((\d+) (\d+) (\d+) \/ ([^)]+)\)/g

  return {
    postcssPlugin: 'legacy-tailwind-colors',
    Declaration(decl) {
      if (!decl.value.includes('rgb(') || !decl.value.includes(' / ')) return

      decl.value = decl.value.replace(rgbWithAlpha, (_match, r, g, b, alpha) => {
        return `rgba(${r}, ${g}, ${b}, ${alpha.trim()})`
      })
    },
  }
}

legacyTailwindColors.postcss = true

export default {
  plugins: [tailwindcss, legacyTailwindColors(), autoprefixer],
}
