import type { Command } from 'commander'
import { GreetingService } from '@core/GreetingService.js'

interface GreetOptions {
  name?: string
}

export function registerGreetCommand(program: Command): void {
  program
    .command('greet')
    .description('Greet a user by name')
    .option('--name <name>', 'Name of the user to greet')
    .action((options: GreetOptions) => {
      const name = options.name?.trim() ? options.name : 'Guest'
      const message = GreetingService.greet(name)
      console.log(message)
    })
}
