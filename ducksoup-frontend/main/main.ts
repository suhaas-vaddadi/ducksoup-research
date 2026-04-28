import path from 'path'
import { app, ipcMain, dialog } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

;(async () => {
  await app.whenReady()

  const mainWindow = createWindow('main', {
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  })

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  app.quit()
})

// IPC: Select a folder for saving recordings
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Recording Output Folder',
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// IPC: Save a recording blob to disk
ipcMain.handle('save-recording', async (_event, { folder, filename, buffer }: { folder: string; filename: string; buffer: ArrayBuffer }) => {
  const fs = await import('fs/promises')
  const filePath = path.join(folder, filename)
  await fs.writeFile(filePath, Buffer.from(buffer))
  return filePath
})

// IPC: Get DuckSoup server URL
ipcMain.handle('get-ducksoup-url', () => {
  return 'http://localhost:8100'
})

// Generic message handler (kept from template)
ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
