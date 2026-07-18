import { mount } from 'svelte';
import Demo from './Demo.svelte';

const target = document.getElementById('app');
if (target) mount(Demo, { target });
