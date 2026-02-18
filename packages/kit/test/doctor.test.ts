import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { collectDoctorReport, formatDoctorReport } from '../src/doctor'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('doctor report', () => {
  it('warns when routes/build artifacts are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-doctor-'))
    dirs.push(root)

    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'test-app',
          private: true,
          dependencies: {
            '@fictjs/kit': '^0.1.0',
            fict: '^0.10.0',
          },
        },
        null,
        2,
      ),
    )

    const report = await collectDoctorReport({ cwd: root })

    expect(getCheck(report, 'routes_count')?.status).toBe('warn')
    expect(getCheck(report, 'out_dir')?.status).toBe('warn')
    expect(getCheck(report, 'client_dir')?.status).toBe('warn')

    const output = formatDoctorReport(report)
    expect(output).toContain('[fict-kit] doctor report')
    expect(output).toContain('summary:')
  })

  it('reports route and build outputs when present', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-doctor-'))
    dirs.push(root)

    await writeFixture(root, {
      'package.json': JSON.stringify(
        {
          name: 'test-app',
          private: true,
          dependencies: {
            '@fictjs/kit': '^0.1.0',
            fict: '^0.10.0',
          },
        },
        null,
        2,
      ),
      'src/routes/index.tsx': 'export default function Page() { return null }',
      'dist/client/fict.manifest.json': '{}',
      'dist/server/entry.js': '',
    })

    const report = await collectDoctorReport({ cwd: root })

    expect(getCheck(report, 'routes_count')?.status).toBe('ok')
    expect(getCheck(report, 'out_dir')?.status).toBe('ok')
    expect(getCheck(report, 'client_dir')?.status).toBe('ok')
    expect(getCheck(report, 'server_dir')?.status).toBe('ok')
    expect(getCheck(report, 'manifest_file')?.status).toBe('ok')
  })
})

function getCheck(
  report: Awaited<ReturnType<typeof collectDoctorReport>>,
  id: string,
): { id: string; status: string } | undefined {
  return report.checks.find(check => check.id === id)
}

async function writeFixture(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relative, content]) => {
      const absolute = path.join(root, relative)
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, content)
    }),
  )
}
