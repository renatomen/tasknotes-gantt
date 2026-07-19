import { mount } from 'svelte';
import CalendarDemo from './CalendarDemo.svelte';

const target = document.getElementById('app');
if (target) mount(CalendarDemo, { target });
