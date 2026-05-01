import { mount } from '@tu-lang/runtime'
import * as AppMod from './App.tu'

mount(() => AppMod.App(), document.getElementById('app'))
