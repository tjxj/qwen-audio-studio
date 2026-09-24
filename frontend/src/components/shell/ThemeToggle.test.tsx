import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {ProjectHeader} from './ProjectHeader';
import {getSettings,patchSettings} from '../../api';
vi.mock('../../api',()=>({getSettings:vi.fn(),patchSettings:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();document.documentElement.dataset.theme='light';vi.mocked(getSettings).mockResolvedValue({revision:3,theme:'light'} as any)});
it('switches theme from the header and persists it',async()=>{
 vi.mocked(patchSettings).mockResolvedValue({revision:4,theme:'dark'} as any);
 render(<MemoryRouter><ProjectHeader connection="connected"/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:'切换为深色模式'}));
 await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('dark'));
 expect(patchSettings).toHaveBeenCalledWith({expected_revision:3,theme:'dark'});
 expect(screen.getByRole('button',{name:'切换为浅色模式'})).toBeVisible();
});
it('retains the current theme when persistence fails',async()=>{
 vi.mocked(patchSettings).mockRejectedValue(new Error('设置暂时无法保存'));
 render(<MemoryRouter><ProjectHeader connection="connected"/></MemoryRouter>);
 await userEvent.click(screen.getByRole('button',{name:'切换为深色模式'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('设置暂时无法保存');
 expect(document.documentElement.dataset.theme).toBe('light');
});
