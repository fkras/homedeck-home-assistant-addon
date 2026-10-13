import { render } from 'preact';

import './editor';
import './style.css';
import { App, boot } from './ui/App';

render(<App />, document.getElementById('app')!);
boot();
