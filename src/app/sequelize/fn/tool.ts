
import * as os from 'os';


export const getServerExternalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            // 내부 IP가 아닌 IPv4 주소만 반환
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    // 외부 IP가 없는 경우 127.0.0.1 반환
    return '127.0.0.1';
};

export const getServerIP = () => {
    const interfaces = os.networkInterfaces();
    let selectedIP = '127.0.0.1'; // 기본값 (자기 자신)

    // 로컬 환경인지 확인 (localhost 또는 127.0.0.1이 있으면 로컬 환경)
    for (const [name, ifaceList] of Object.entries(interfaces)) {
        for (const iface of ifaceList || []) {
            if (iface.family === 'IPv4' && iface.address === '127.0.0.1') {
                return '127.0.0.1'; // 로컬 IP인 경우 127.0.0.1 반환
            }
        }
    }

    // 로컬 환경이 아니면, 외부 IP를 반환
    for (const [name, ifaceList] of Object.entries(interfaces)) {
        for (const iface of ifaceList || []) {
            // IPv4만 고려하며, 내부 IP와 가상 네트워크를 제외
            if (iface.family === 'IPv4' && !iface.internal) {
                const isPrivate =
                    iface.address.startsWith('10.') ||
                    iface.address.startsWith('192.168.') ||
                    (iface.address.startsWith('172.') && parseInt(iface.address.split('.')[1], 10) >= 16 && parseInt(iface.address.split('.')[1], 10) <= 31);

                // WSL이나 Hyper-V와 같은 가상 네트워크 인터페이스 제외
                const isVirtualAdapter = name.toLowerCase().includes('wsl') || name.toLowerCase().includes('hyper-v');

                if (isPrivate && !isVirtualAdapter) {
                    return iface.address; // 최적의 IP 반환
                }

                // 가상 네트워크 제외 후 후보 IP 저장
                if (!isVirtualAdapter) {
                    selectedIP = iface.address;
                }
            }
        }
    }

    return selectedIP; // 적합한 IP가 없을 경우 대체 IP 반환
};
