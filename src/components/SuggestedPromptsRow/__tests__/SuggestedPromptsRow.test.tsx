import React from 'react';
import {fireEvent, render} from '../../../../jest/test-utils';
import {SuggestedPromptsRow} from '../SuggestedPromptsRow';

describe('SuggestedPromptsRow', () => {
  const long =
    'Sort the shelf in the garage and then call the dump about old paint tins';

  it("an assistant's prompts are cut to two lines", () => {
    const {getByText} = render(
      <SuggestedPromptsRow prompts={[long]} onSelect={jest.fn()} />,
    );
    expect(getByText(long).props.numberOfLines).toBe(2);
  });

  it("with fullText (a loop's next steps), the whole text shows; a tap sends it", () => {
    const onSelect = jest.fn();
    const {getByText, getByTestId} = render(
      <SuggestedPromptsRow fullText prompts={[long]} onSelect={onSelect} />,
    );
    expect(getByText(long).props.numberOfLines).toBeUndefined();
    fireEvent.press(getByTestId('suggested-prompt-chip-0'));
    expect(onSelect).toHaveBeenCalledWith(long);
  });
});
