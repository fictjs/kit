import { cac } from 'cac'

export function runCli(argv: string[] = process.argv): void {
  const cli = cac('fict-kit')

  cli.command('dev', 'Start dev server').action(() => {
    console.log('fict-kit dev is not implemented yet')
  })

  cli.command('build', 'Build app').action(() => {
    console.log('fict-kit build is not implemented yet')
  })

  cli.command('preview', 'Preview production build').action(() => {
    console.log('fict-kit preview is not implemented yet')
  })

  cli.help()
  cli.version('0.1.0')
  cli.parse(argv)
}
