import chalk from 'chalk'
import execa from 'execa'
import { existsSync, mkdirSync, rmdirSync } from 'fs'
import { ensureDirSync, removeSync } from 'fs-extra'
import fetch from 'node-fetch'
import ora from 'ora'
import { homedir } from 'os'
import { dirname, join, posix, resolve, sep } from 'path'
import { bin_name, config, log } from '..'
import { ENGINE_DIR } from '../constants'
import {
  getConfig,
  SupportedProducts,
  walkDirectory,
  writeMetadata,
} from '../utils'
import { downloadFileToLocation } from '../utils/download'
import { downloadArtifacts } from './download-artifacts'

const gFFVersion = getConfig().version.version

let initProgressText = 'Initialising...'
let initProgress: any = ora({
  text: `Initialising...`,
  prefixText: chalk.blueBright.bold('00:00:00'),
  spinner: {
    frames: [''],
  },
  indent: 0,
})

function getMozPlatformIdentifier() {
  let platform: NodeJS.Platform | string = process.platform

  if (platform == 'linux') {
    platform = 'linux64'
  }

  return platform
}

export const download = async (): Promise<void> => {
  setInterval(() => {
    if (initProgress) {
      initProgress.text = initProgressText
      initProgress.prefixText = chalk.blueBright.bold(log.getDiff())
    }
  }, 100)

  const version = gFFVersion

  // If gFFVersion isn't specified, provide legible error
  if (!version) {
    log.error(
      'You have not specified a version of firefox in your config file. This is required to build a firefox fork'
    )
    process.exit(1)
  }

  // The location to download the firefox source code from the web
  const sourceFileName = await downloadFirefoxSource(version)

  await unpackFirefoxSource(sourceFileName)

  if (process.platform === 'win32') {
    if (existsSync(resolve(homedir(), '.mozbuild'))) {
      log.info('Mozbuild directory already exists, not redownloading')
    } else {
      log.info('Mozbuild not found, downloading artifacts.')
      await downloadArtifacts()
    }
  }

  if (process.env.CI_SKIP_INIT) return log.info('Skipping initialisation.')

  const initProc = execa('npx', ['melon', 'ff-init', 'engine'])

  ;(initProc.stdout as any).on('data', (data: string) =>
    log.debug(data.toString())
  )
  ;(initProc.stdout as any).on('error', (data: string) => log.warning(data))

  initProc.on('exit', async () => {
    log.success(
      `You should be ready to make changes to Dot Browser.\n\n\t   You should import the patches next, run |${bin_name} import|.\n\t   To begin building Dot, run |${bin_name} build|.`
    )
    console.log()

    await writeMetadata()

    let cwd = process.cwd().split(sep).join(posix.sep)

    if (process.platform == 'win32') {
      cwd = './'
    }

    removeSync(resolve(cwd, '.dotbuild', 'engines', sourceFileName))

    process.exit(0)
  })
}

const onData = (data: any) => {
  const d = data.toString()

  d.split('\n').forEach((line: any) => {
    if (line.trim().length !== 0) {
      const t = line.split(' ')
      t.shift()
      initProgressText = t.join(' ')
    }
  })
}

const unpackFirefoxSource = (name: string): Promise<void> => {
  return new Promise((res) => {
    let cwd = process.cwd().split(sep).join(posix.sep)

    if (process.platform == 'win32') {
      cwd = './'
    }

    initProgress.start()
    initProgressText = `Unpacking Firefox...`

    try {
      rmdirSync(ENGINE_DIR)
    } catch (e) {}
    ensureDirSync(ENGINE_DIR)

    const tarProc = execa('tar', [
      '--transform',
      `s,firefox-${gFFVersion},engine,`,
      `--show-transformed`,
      '-xf',
      resolve(cwd, '.dotbuild', 'engines', name),
    ])

    ;(tarProc.stdout as any).on('data', onData)
    ;(tarProc.stdout as any).on('error', onData)

    tarProc.on('exit', () => {
      initProgressText = ''
      initProgress.stop()
      initProgress = null

      res()
    })
  })
}

async function downloadFirefoxSource(version: string) {
  const base = `https://archive.mozilla.org/pub/firefox/releases/${version}/source/`
  const filename = `firefox-${version}.source.tar.xz`

  const url = base + filename

  log.info(`Locating Firefox release ${version}...`)

  ensureDirSync(resolve(process.cwd(), `.dotbuild`, `engines`))

  if (
    existsSync(
      resolve(
        process.cwd(),
        `.dotbuild`,
        `engines`,
        `firefox-${version.split('b')[0]}`
      )
    )
  ) {
    log.error(
      `Cannot download version ${
        version.split('b')[0]
      } as it already exists at "${resolve(
        process.cwd(),
        `firefox-${version.split('b')[0]}`
      )}"`
    )
  }

  if (version.includes('b'))
    log.warning(
      'Version includes non-numeric characters. This is probably a beta.'
    )

  // Do not re-download if there is already an existing workspace present
  if (existsSync(ENGINE_DIR)) {
    log.error(
      `Workspace already exists.\nRemove that workspace and run |${bin_name} download ${version}| again.`
    )
  }

  log.info(`Downloading Firefox release ${version}...`)

  await downloadFileToLocation(
    url,
    resolve(process.cwd(), `.dotbuild`, `engines`, filename)
  )
  return filename
}
