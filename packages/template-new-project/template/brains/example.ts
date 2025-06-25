import { brain } from '@positronic/core';

const exampleBrain = brain('example')
  .step('Start', ({ state }) => ({
    ...state,
    message: 'Welcome to Positronic!',
  }))
  .step('Finish', ({ state }) => ({
    ...state,
    finalMessage: state.message + ' Your project is set up.',
  }));

export default exampleBrain;