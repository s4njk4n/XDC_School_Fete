// SPDX-License-Identifier: UNLICENSED
// Copyright (c) 2026 XDC Outpost. All rights reserved.
pragma solidity ^0.8.24;

/// @title  FeteTickets
/// @notice A closed-loop "ticket" token for a school fete. Tickets have no
///         monetary value outside the fete; they simply replace paper tickets.
///         Standard XRC-20 (XDC Network's ERC-20-compatible token standard) plus:
///           - fete name + ticket price (in cents) stored on-chain so every app
///             can read the settings from one address
///           - give(): transfer tickets AND forward a little XDC "running credit"
///             in a single transaction, so new phones can pay without ever
///             needing to know what XDC or gas is.
///           - addHelper(): the organiser records each ticket booth / stall (with
///             its name) on-chain while loading it up, so the team list can be
///             rebuilt on any phone if the organiser's phone is lost.
/// @dev    Built by XDC Outpost. Compiled with solc 0.8.24, evmVersion "paris".
contract FeteTickets {
    string public name;
    string public constant symbol = "TIX";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public organiser;
    uint256 public centsPerTicket;   // e.g. 100 = $1.00 per ticket
    uint256 public immutable createdAtBlock;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event SettingsChanged(string name, uint256 centsPerTicket);
    /// kind: 1 = ticket booth, 2 = stall, 0 = removed from the team
    event HelperSet(address indexed helper, uint8 kind, string label);

    modifier onlyOrganiser() {
        require(msg.sender == organiser, "Only the organiser");
        _;
    }

    constructor(string memory feteName, uint256 wholeTickets, uint256 cents) {
        require(cents > 0, "Price required");
        name = feteName;
        centsPerTicket = cents;
        organiser = msg.sender;
        createdAtBlock = block.number;
        uint256 supply = wholeTickets * 1e18;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
        emit SettingsChanged(feteName, cents);
    }

    // ---------------------------------------------------------------- XRC-20

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "Allowance too low");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    // ------------------------------------------------------------- fete extras

    /// @notice Send tickets and (optionally) forward the attached XDC to the
    ///         recipient as running credit, in one transaction.
    function give(address to, uint256 value) external payable returns (bool) {
        if (value > 0) _transfer(msg.sender, to, value);
        if (msg.value > 0) {
            (bool ok, ) = payable(to).call{value: msg.value}("");
            require(ok, "Credit forward failed");
        }
        return true;
    }

    /// @notice Organiser adds/renames/removes a booth or stall, optionally sending
    ///         tickets and running credit to it in the same transaction.
    function addHelper(address helper, uint256 value, uint8 kind, string calldata label) external payable onlyOrganiser {
        require(helper != address(0), "Bad address");
        require(kind <= 2, "Bad kind");
        emit HelperSet(helper, kind, label);
        if (value > 0) _transfer(msg.sender, helper, value);
        if (msg.value > 0) {
            (bool ok, ) = payable(helper).call{value: msg.value}("");
            require(ok, "Credit forward failed");
        }
    }

    function setSettings(string calldata feteName, uint256 cents) external onlyOrganiser {
        require(cents > 0, "Price required");
        name = feteName;
        centsPerTicket = cents;
        emit SettingsChanged(feteName, cents);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "Bad address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "Not enough tickets");
        unchecked {
            balanceOf[from] = bal - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
