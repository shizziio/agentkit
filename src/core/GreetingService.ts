import { GreetingService as ServiceImpl } from '../services/GreetingService.js'

const _impl = new ServiceImpl()

export const GreetingService = {
  greet(name: string): string {
    return _impl.greet(name)
  },
}
