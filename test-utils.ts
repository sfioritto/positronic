/**
 * Helper function to get the next value from an AsyncIterator.
 * Throws an error if the iterator is done.
 */
export const nextStep = async <T>(
  workflowRun: AsyncIterator<T>
): Promise<T> => {
  const result = await workflowRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};
