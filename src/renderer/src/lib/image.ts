const TARGET_SIZE = 640
const MAX_DATA_URL = 700_000

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif'
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    input.click()
  })
}

export async function pickCoverImage(): Promise<string | null> {
  const file = await chooseFile()
  if (!file) return null
  if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Не удалось открыть изображение')
  }
  try {
    if (bitmap.width < 32 || bitmap.height < 32) throw new Error('Изображение слишком маленькое')
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = Math.round((bitmap.width - side) / 2)
    const sy = Math.round((bitmap.height - side) / 2)
    let size = TARGET_SIZE
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось обработать изображение')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
      const quality = attempt === 0 ? 0.88 : attempt === 1 ? 0.82 : 0.72
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= MAX_DATA_URL) return dataUrl
      size = Math.max(256, Math.round(size * 0.8))
    }
    throw new Error('Не удалось подготовить изображение')
  } finally {
    bitmap.close()
  }
}
