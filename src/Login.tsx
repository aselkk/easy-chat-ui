import { useState } from 'react';

export const Login = ({setNickname}: {
    setNickname: (nickname: string) => void
}) => {
    const [nicknameValue, setNicknameValue] = useState('')
    const [errorMsg, setErrorMsg] = useState('')
    return (
        <section className="flex justify-center items-center h-screen bg-gray-100">
            <div className="max-w-md w-full bg-white rounded p-6 space-y-4">
                <div className="mb-4">
                  <p className="text-gray-600">Welcome to the chat app!</p>
                </div>
                <div>
                  <input 
                    className="w-full p-4 text-sm bg-gray-50 focus:outline-none border border-gray-200 rounded text-gray-600" 
                    type="text" 
                    placeholder="Nickname"
                    onChange={(e) => setNicknameValue(e.target.value)}
                    value={nicknameValue}
                  />
                  {errorMsg ? (
                      <span className='text-red-500 text-xs'>{errorMsg}</span>
                  ) : ('')}
                </div>
                <div>
                    <button 
                      onClick={() => nicknameValue
                        ? setNickname(nicknameValue) 
                        : setErrorMsg('Please, enter your nickname')}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded text-sm font-bold text-gray-50 transition duration-200">Join</button>
                </div>
            </div>
        </section>
    );
};
