// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
import execa from 'execa'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { bin_name, config } from '..'
import { BUILD_TARGETS, CONFIGS_DIR, ENGINE_DIR } from '../constants'
import { log } from '../log'
import { patchCheck } from '../middleware/patch-check'
import { dispatch, stringTemplate } from '../utils'

const platform: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
}

const applyConfig = async (os: string, arch: string) => {
  log.info('Applying mozconfig...')

  let changeset

  try {
    // Retrieve changeset
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'])
    changeset = stdout.trim()
  } catch (e) {
    log.warning(
      'Melon expects that you are building your browser with git as your version control'
    )
    log.warning(
      'If you are using some other version control system, please migrate to git'
    )
    log.warning('Otherwise, you can setup git in this folder by running:')
    log.warning('   |git init|')

    throw e
  }

  const templateOptions = {
    name: config.name,
    vendor: config.name,
    appId: config.appId,
    brandingDir: existsSync(join(ENGINE_DIR, 'branding', 'melon'))
      ? 'branding/melon'
      : 'branding/unofficial',
    binName: config.binaryName,
    changeset,
  }

  const commonConfig = stringTemplate(
    readFileSync(resolve(CONFIGS_DIR, 'common', 'mozconfig'), 'utf-8'),
    templateOptions
  )

  const osConfig = stringTemplate(
    readFileSync(
      resolve(
        CONFIGS_DIR,
        os,
        arch === 'i686' ? 'mozconfig-i686' : 'mozconfig'
      ),
      'utf-8'
    ),
    templateOptions
  )

  // Allow a custom config to be placed in /mozconfig. This will not be committed
  // to origin
  let customConfig = existsSync(join(process.cwd(), 'mozconfig'))
    ? readFileSync(join(process.cwd(), 'mozconfig')).toString()
    : ''

  customConfig = stringTemplate(customConfig, templateOptions)

  const internalConfig = `# Internally defined by melon`

  const mergedConfig =
    `# This file is automatically generated. You should only modify this if you know what you are doing!\n\n` +
    commonConfig +
    '\n\n' +
    osConfig +
    '\n\n' +
    customConfig +
    '\n\n' +
    internalConfig

  writeFileSync(resolve(ENGINE_DIR, 'mozconfig'), mergedConfig)

  log.info(`Config for this \`${os}\` build:`)

  mergedConfig.split('\n').map((ln) => {
    if (ln.startsWith('mk') || ln.startsWith('ac') || ln.startsWith('export'))
      log.info(
        `\t${ln
          .replace(/mk_add_options /, '')
          .replace(/ac_add_options /, '')
          .replace(/export /, '')}`
      )
  })
}

const genericBuild = async (os: string, fast = false) => {
  log.info(`Building for "${os}"...`)

  log.warning(
    `If you get any dependency errors, try running |${bin_name} bootstrap|.`
  )

  const buildOptions = ['build']

  if (fast) {
    buildOptions.push('faster')
  }

  log.info(buildOptions.join(' '))

  log.debug(`Running with build options ${buildOptions.join(', ')}`)
  log.debug(`Mach exists: ${existsSync(join(ENGINE_DIR, 'mach'))}`)
  log.debug(
    `Mach contents: \n ${readFileSync(join(ENGINE_DIR, 'mach'))}\n\n===END===`
  )

  await dispatch(`./mach`, buildOptions, ENGINE_DIR, true)
}

const parseDate = (d: number) => {
  d /= 1000
  const h = Math.floor(d / 3600)
  const m = Math.floor((d % 3600) / 60)
  const s = Math.floor((d % 3600) % 60)

  const hDisplay = h > 0 ? h + (h == 1 ? ' hour, ' : ' hours, ') : ''
  const mDisplay = m > 0 ? m + (m == 1 ? ' minute, ' : ' minutes, ') : ''
  const sDisplay = s > 0 ? s + (s == 1 ? ' second' : ' seconds') : ''
  return hDisplay + mDisplay + sDisplay
}

const success = (date: number) => {
  // mach handles the success messages
  console.log()
  log.info(`Total build time: ${parseDate(Date.now() - date)}.`)
}

interface Options {
  arch: string
  ui: boolean
}

export const build = async (options: Options): Promise<void> => {
  const d = Date.now()

  // Host build

  const prettyHost = platform[process.platform]

  if (BUILD_TARGETS.includes(prettyHost)) {
    await patchCheck()

    await applyConfig(prettyHost, options.arch)

    log.info('Starting build...')

    await genericBuild(prettyHost, options.ui).then((_) => success(d))
  }
}
