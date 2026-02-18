import { cac } from 'cac'

export function runCreateFict(argv: string[] = process.argv): void {
  const cli = cac('create-fict')

  cli
    .command('[dir]', 'Create a new Fict app')
    .action((dir = 'fict-app') => {
      console.log(`create-fict scaffolder placeholder: ${dir}`)
    })

  cli.help()
  cli.version('0.1.0')
  cli.parse(argv)
}
