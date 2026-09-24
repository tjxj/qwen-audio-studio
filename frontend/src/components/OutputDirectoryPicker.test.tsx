import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi} from 'vitest';
import {OutputDirectoryPicker} from './OutputDirectoryPicker';
import {request} from '../api';
vi.mock('../api',()=>({request:vi.fn()}));
it('opens only the registered output directory in Finder',async()=>{
 vi.mocked(request).mockResolvedValueOnce({id:'dir_example',display_name:'测试输出'}).mockResolvedValueOnce(undefined);
 render(<OutputDirectoryPicker value={null} onChange={vi.fn()}/>);
 await screen.findByText('测试输出');
 await userEvent.click(screen.getByRole('button',{name:'在Finder中打开输出文件夹'}));
 await waitFor(()=>expect(request).toHaveBeenLastCalledWith('/api/directories/dir_example/reveal','POST',{}));
});
