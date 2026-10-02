import './styles.css'
import { startRouter } from './router'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('#app is missing from index.html')
startRouter(app)
